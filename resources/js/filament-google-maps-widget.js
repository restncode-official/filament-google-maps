import { MarkerClusterer } from "@googlemaps/markerclusterer";
import debounce from "underscore/modules/debounce.js";

export default function filamentGoogleMapsWidget({
    cachedData,
    config,
    mapEl,
}) {
    return {
        map: null,
        bounds: null,
        infoWindow: null,
        mapEl: null,
        data: null,
        markers: [],
        layers: [],
        modelIds: [],
        mapIsFilter: false,
        clusterer: null,
        center: null,
        isMapDragging: false,
        isIdleSkipped: false,
        config: {
            center: {
                lat: 0,
                lng: 0,
            },
            clustering: false,
            controls: {
                mapTypeControl: true,
                scaleControl: true,
                streetViewControl: true,
                rotateControl: true,
                fullscreenControl: true,
                searchBoxControl: false,
                zoomControl: false,
            },
            fit: true,
            mapIsFilter: false,
            gmaps: "",
            layers: [],
            zoom: 12,
            markerAction: null,
            mapConfig: [],
        },

        loadGMaps: function () {
            if (!document.getElementById("filament-google-maps-google-maps-js")) {
                const script = document.createElement("script");
                script.id = "filament-google-maps-google-maps-js";
                window.filamentGoogleMapsAsyncLoad = this.createMap.bind(this);
                script.src =
                    this.config.gmaps + "&callback=filamentGoogleMapsAsyncLoad";
                document.head.appendChild(script);
            } else {
                const waitForGlobal = function (key, callback) {
                    if (window[key]) {
                        callback();
                    } else {
                        setTimeout(function () {
                            waitForGlobal(key, callback);
                        }, 100);
                    }
                };

                waitForGlobal(
                    "filamentGoogleMapsAPILoaded",
                    function () {
                        this.createMap();
                    }.bind(this)
                );
            }
        },

        init: function () {
            this.mapEl = document.getElementById(mapEl) || mapEl;
            this.data = cachedData;
            this.config = { ...this.config, ...config };
            this.loadGMaps();
        },

        callWire: function (thing) { },

        createMap: function () {
            window.filamentGoogleMapsAPILoaded = true;
            this.infoWindow = new google.maps.InfoWindow({
                content: "",
                disableAutoPan: true,
            });

            this.map = new google.maps.Map(this.mapEl, {
                center: this.config.center,
                zoom: this.config.zoom,
                ...this.config.controls,
                ...this.config.mapConfig,
            });

            this.center = this.config.center;

            this.createMarkers();

            this.createClustering();

            this.createLayers();

            this.idle();

            // (...args) does not work, for livewire events
            Livewire.on("fgm:updateMapData", (args) => {
                if (!Array.isArray(args) || args.length === 0) {
                    return;
                }

                const payload = args[0];

                if (!payload || !Object.prototype.hasOwnProperty.call(payload, "data")) {
                    return;
                }

                const markersData = JSON.parse(JSON.stringify(payload.data));

                this.update(markersData);
            });

            window.addEventListener(
                "filament-google-maps::widget/setMapCenter",
                (event) => {
                    this.recenter(event.detail);
                }
            );

            this.show(true);
        },
        show: function (force = false) {
            if (this.markers.length > 0 && this.config.fit) {
                this.fitToBounds(force);
            } else {
                if (this.markers.length > 0) {
                    this.map.setCenter(this.markers[0].getPosition());
                } else {
                    this.map.setCenter(this.config.center);
                }
            }
        },
        createLayers: function () {
            this.layers = this.config.layers.map((layerUrl) => {
                return new google.maps.KmlLayer({
                    url: layerUrl,
                    map: this.map,
                });
            });
        },
        createMarker: function (location) {
            let markerIcon;

            if (location.icon && typeof location.icon === "object") {
                if (location.icon.hasOwnProperty("url")) {
                    markerIcon = {
                        url: location.icon.url,
                    };

                    if (
                        location.icon.hasOwnProperty("type") &&
                        location.icon.type === "svg" &&
                        location.icon.hasOwnProperty("scale")
                    ) {
                        markerIcon.scaledSize = new google.maps.Size(
                            location.icon.scale[0],
                            location.icon.scale[1]
                        );
                    }
                }
            }

            const point = location.location;
            const label = location.label;

            const marker = new google.maps.Marker({
                position: point,
                title: label,
                model_id: location.id,
                ...(markerIcon && { icon: markerIcon }),
            });

            if (this.modelIds.indexOf(location.id) === -1) {
                this.modelIds.push(location.id);
            }

            return marker;
        },
        createMarkers: function () {
            this.modelIds = [];

            this.markers = this.data.map((location) => {
                const marker = this.createMarker(location);

                if (!this.config.clustering) {
                    marker.setMap(this.map);
                }

                if (this.config.markerAction) {
                    google.maps.event.addListener(marker, "click", () => {
                        this.$wire.mountAction(this.config.markerAction, {
                            model_id: marker.model_id,
                        });
                    });
                } else {
                    google.maps.event.addListener(marker, "click", () => {
                        this.infoWindow.setContent(marker.getTitle());
                        this.infoWindow.open(this.map, marker);
                    });
                }

                return marker;
            });
        },
        removeMarker: function (marker) {
            marker.setMap(null);
        },
        removeMarkers: function () {
            for (const marker of this.markers) {
                marker.setMap(null);
            }

            this.markers = [];
            this.modelIds = [];
        },
        fitToBounds: function (force = false) {
            if (
                this.markers.length > 0 &&
                this.config.fit &&
                (force || !this.config.mapIsFilter)
            ) {
                this.bounds = new google.maps.LatLngBounds();

                for (const marker of this.markers) {
                    this.bounds.extend(marker.getPosition());
                }

                this.map.fitBounds(this.bounds);
            }
        },
        createClustering: function () {
            if (!this.config.clustering || this.markers.length === 0) {
                return;
            }

            this.destroyClusterer();

            this.clusterer = new MarkerClusterer({
                map: this.map,
                markers: this.markers,
            });
        },
        updateClustering: function () {
            if (!this.config.clustering) {
                return;
            }

            if (this.markers.length === 0) {
                this.destroyClusterer();
                return;
            }

            this.createClustering();
        },
        moved: function () {
            function areEqual(array1, array2) {
                if (array1.length === array2.length) {
                    return array1.every((element, index) => {
                        if (element === array2[index]) {
                            return true;
                        }

                        return false;
                    });
                }

                return false;
            }

            const bounds = this.map.getBounds();
            const visible = this.markers.filter((marker) => {
                return bounds.contains(marker.getPosition());
            });
            const ids = JSON.parse(JSON.stringify(visible.map((marker) => marker.model_id)));

            if (!areEqual(this.modelIds, ids)) {
                this.modelIds = ids;
                this.$wire.set("mapFilterIds", ids);
            }
        },
        idle: function () {
            if (this.config.mapIsFilter) {
                let that = self;
                const debouncedMoved = debounce(this.moved, 1000).bind(this);

                google.maps.event.addListener(this.map, "idle", (event) => {
                    if (self.isMapDragging) {
                        self.idleSkipped = true;
                        return;
                    }
                    self.idleSkipped = false;
                    debouncedMoved();
                });
                google.maps.event.addListener(this.map, "dragstart", (event) => {
                    self.isMapDragging = true;
                });
                google.maps.event.addListener(this.map, "dragend", (event) => {
                    self.isMapDragging = false;
                    if (self.idleSkipped === true) {
                        debouncedMoved();
                        self.idleSkipped = false;
                    }
                });
                google.maps.event.addListener(this.map, "bounds_changed", (event) => {
                    self.idleSkipped = false;
                });
            }
        },
        destroyClusterer: function () {
            if (!this.clusterer) {
                return;
            }

            this.clusterer.clearMarkers();
            this.clusterer.setMap(null);
            this.clusterer = null;
        },
        update: function (data) {
            this.data = Array.isArray(data) ? data : [];

            this.destroyClusterer();

            this.removeMarkers();

            this.createMarkers();

            this.updateClustering();

            this.show(true);
        },
        recenter: function (data) {
            this.map.panTo({ lat: data.lat, lng: data.lng });
            this.map.setZoom(data.zoom);
        },
    };
}
