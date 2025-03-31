//have external library but works

let highlightedStop = null;  // This tracks the currently highlighted stop
let currentETAContainer = null;  // This tracks the currently highlighted stop
//let map = null;  // This will store our map instance
//let marker = null;  // This will store our marker

// Fetch bus stops data
async function fetchBusStops() {
    const response = await fetch('https://data.etabus.gov.hk/v1/transport/kmb/stop'); 
    if (!response.ok) {
        throw new Error('The request is blocked');
    }
    
    return await response.json();
}

// Load bus stops
async function loadBusStops() {
    let stopList = sessionStorage.getItem('StopList');

    if (!stopList) {
        stopList = await fetchBusStops();
        sessionStorage.setItem('StopList', JSON.stringify(stopList));
    } else {
        stopList = JSON.parse(stopList);
    }

    return stopList.data;
}

// Fetch ETA for a specific stop
async function fetchStopETA(stopId) {
    try {
        const response = await fetch(`https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${stopId}`);
        if (!response.ok) {
            throw new Error('Failed to fetch ETA data');
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching ETA:', error);
        throw error; // Re-throw to handle in the calling function
    }
}

// Haversine formula to calculate distance
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters 
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
}

function formatTime(isoString) {
    const date = new Date(isoString);
    const options = { hour: 'numeric', minute: 'numeric', hour12: true };
    return date.toLocaleString('en-US', options);
}

// Display ETAs on the page
function displayETAs(etaData, container) {
    container.innerHTML = ''; // Clear previous ETAs
    
    // Create a flex container for ETA and map
    const contentWrapper = document.createElement('div');
    contentWrapper.style.display = 'flex';
    contentWrapper.style.gap = '20px';
    contentWrapper.style.width = '100%';
    
    // Create ETA container (left side)
    const etaContent = document.createElement('div');
    etaContent.style.flex = '1';
    
    // Create map container (right side)
    const mapContainer = document.createElement('div');
    mapContainer.id = 'stop-map';
    mapContainer.style.flex = '1';
    mapContainer.style.height = '300px';
    mapContainer.style.border = '1px solid #ccc';
    mapContainer.style.borderRadius = '8px';
    
    contentWrapper.appendChild(etaContent);
    contentWrapper.appendChild(mapContainer);
    container.appendChild(contentWrapper);

    const validETAs = etaData.data.filter(eta => eta.eta !== null);
    
    if (validETAs.length === 0) {
        etaContent.textContent = 'No bus route information';
        return;
    }

    const routes = {};
    validETAs.forEach(eta => {
        const key = `${eta.route}_${eta.dir}`;
        if (!routes[key]) {
            routes[key] = {
                route: eta.route,
                dest_en: eta.dest_en,
                etas: []
            };
        }
        routes[key].etas.push(formatTime(eta.eta));
    });

    for (const key in routes) {
        const route = routes[key];
        
        const routeDiv = document.createElement('div');
        routeDiv.style.display = 'flex';
        routeDiv.style.flexDirection = 'column'; // Stack elements vertically
        routeDiv.style.marginTop = '10px';
        
        // Route number and destination line
        const routeLine = document.createElement('div');
        routeLine.style.display = 'flex';
        routeLine.style.gap = '50px';
        routeLine.style.alignItems = 'baseline';
        
        const routeSpan = document.createElement('span');
        routeSpan.textContent = route.route;
        routeSpan.style.fontWeight = 'bold';
        routeSpan.style.minWidth = '20px'; // Fixed width for alignment
        
        const destSpan = document.createElement('span');
        destSpan.textContent = route.dest_en.toLowerCase(); // Lowercase destination
        destSpan.style.flexGrow = '1';
        
        routeLine.appendChild(routeSpan);
        routeLine.appendChild(destSpan);
        
        // ETA line
        const etaLine = document.createElement('div');
        etaLine.style.display = 'flex';
        etaLine.style.gap = '10px';
        
        const etasSpan = document.createElement('span');
        etasSpan.textContent = 'ETA:';
        etasSpan.style.fontWeight = 'bold';
        
        const timeSpan = document.createElement('span');
        timeSpan.textContent = route.etas.join('    '); 
        timeSpan.style.color = 'blue';
        timeSpan.style.fontWeight = 'bold';
        
        etaLine.appendChild(etasSpan);
        etaLine.appendChild(timeSpan);
        
        routeDiv.appendChild(routeLine);
        routeDiv.appendChild(etaLine);
        
        etaContent.appendChild(routeDiv);
    }
}

var map; // Global variable for the map
var busStopMarker; // Global variable for the bus stop marker
var userLocationMarker; // Global variable for the user location marker
var devicePosition = null; // Store device position

function initMap(lat, lng, stopName) {
    // Get the map container and set its dimensions
    const mapContainer = document.getElementById('stop-map');
    mapContainer.style.width = '50%';
    mapContainer.style.height = '400px';

    // Remove previous map if exists
    if (map) {
        map.setTarget(undefined); // Clear the map target
        map = null; // Set map variable to null
    }

    // Create new map
    map = new ol.Map({
        target: 'stop-map',
        layers: [
            new ol.layer.Tile({
                source: new ol.source.OSM()
            })
        ],
        view: new ol.View({
            center: ol.proj.fromLonLat([lng, lat]),
            zoom: 17
        })
    });
    
    // Create bus stop icon style
    const busStopIcon = new ol.style.Style({
        image: new ol.style.Icon({
            anchor: [0.5, 1],
            src: 'bus-icon.ico', // Path to your bus stop icon
            scale: 1
        })
    });
    
    // Remove previous bus stop marker if exists
    if (busStopMarker) {
        map.removeLayer(busStopMarker);
    }
    
    // Add marker for the bus stop
    busStopMarker = new ol.layer.Vector({
        source: new ol.source.Vector({
            features: [
                new ol.Feature({
                    geometry: new ol.geom.Point(ol.proj.fromLonLat([lng, lat])),
                    name: stopName
                })
            ]
        }),
        style: busStopIcon
    });
    
    map.addLayer(busStopMarker);
    
    // Add popup for the bus stop
    const popup = new ol.Overlay({
        element: document.createElement('div'),
        positioning: 'bottom-center',
        stopEvent: false
    });
    map.addOverlay(popup);
    
    busStopMarker.getSource().getFeatures()[0].set('popup', stopName);
    
    map.on('click', function(evt) {
        const feature = map.forEachFeatureAtPixel(evt.pixel, function(feature) {
            return feature;
        });
        
        if (feature) {
            const popupElement = popup.getElement();
            popupElement.innerHTML = feature.get('popup');
            popup.setPosition(evt.coordinate);
        } else {
            popup.setPosition(undefined);
        }
    });
    
    // If we have user location, add the user marker
    if (devicePosition) {
        addUserLocationMarker(devicePosition.coords.latitude, devicePosition.coords.longitude);
    }
}

function addUserLocationMarker(lat, lng) {
    // Store the device position
    devicePosition = {
        coords: {
            latitude: lat,
            longitude: lng
        }
    };
    
    // Create user location icon style
    const userLocationIcon = new ol.style.Style({
        image: new ol.style.Icon({
            anchor: [0.5, 1],
            src: 'map-marker.ico', // Path to your user location icon
            scale: 1
        })
    });
    
    // Remove previous user location marker if exists
    if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
    }
    
    // Add marker for user location
    userLocationMarker = new ol.layer.Vector({
        source: new ol.source.Vector({
            features: [
                new ol.Feature({
                    geometry: new ol.geom.Point(ol.proj.fromLonLat([lng, lat]))
                })
            ]
        }),
        style: userLocationIcon
    });
    
    if (map) {
        map.addLayer(userLocationMarker);
    }
}

// Update the geolocation success callback to add user marker
navigator.geolocation.getCurrentPosition(async (position) => {
    console.log("Geolocation acquired:", position);
    devicePosition = position;
    
    const lat = position.coords.latitude; 
    const lon = position.coords.longitude;
    //const radius = parseInt(radiusSelect.value);

    // ... rest of the existing geolocation success callback code ...
    
    // If we already have a map, add the user location marker
    if (map) {
        addUserLocationMarker(lat, lon);
    }
}, (error) => {
    messageElement.textContent = 'Error getting location: ' + error.message;
    console.log("Geolocation error:", error);
});


// Find nearby bus stops based on user's location
async function findNearbyBusStops() {
    console.log("Finding nearby bus stops...");

    const messageElement = document.getElementById('message');
    const busStopListElement = document.getElementById('bus-stop-list');
    const radiusSelect = document.getElementById('radius');

    messageElement.textContent = '';

    if (!navigator.geolocation) {
        messageElement.textContent = 'Geolocation is not supported by this browser.';
        console.log("Geolocation not supported.");
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        console.log("Geolocation acquired:", position);

        const lat = position.coords.latitude; 
        const lon = position.coords.longitude;
        const radius = parseInt(radiusSelect.value);

        if (isNaN(radius) || radius <= 0) {
            messageElement.textContent = 'Please enter a valid radius.';
            console.log("Invalid radius entered.");
            return;
        }

        const stopList = await loadBusStops();
        console.log("Bus stop list:", stopList);

        const nearbyStops = stopList.filter(stop => {
            const distance = haversine(lat, lon, stop.lat, stop.long);
            //console.log(`Distance: ${distance}m  Stop: ${stop.name_en}`);
            return distance <= radius;
        });

        busStopListElement.innerHTML = '';
        if (nearbyStops.length > 0) {
            nearbyStops.sort((a, b) => {
                return haversine(lat, lon, a.lat, a.long) - haversine(lat, lon, b.lat, b.long);
            });

            nearbyStops.forEach(stop => {
                const distance = haversine(lat, lon, stop.lat, stop.long).toFixed(0);
                const listItem = document.createElement('li');
                
                const stopInfoContainer = document.createElement('div');
                stopInfoContainer.classList.add('stop-info');
                
                const distanceSpan = document.createElement('span');
                // Create a span for the bold 'D'
                const boldD = document.createElement('span');
                boldD.textContent = 'D';
                boldD.style.fontWeight = 'bold';
                // Create a span for the rest of the word
                const remainingDistance = document.createElement('span');
                remainingDistance.textContent = `istance: ${distance}m `;
                // Combine them
                distanceSpan.appendChild(boldD);
                distanceSpan.appendChild(remainingDistance);  

                const stopSpan = document.createElement('span');
                stopSpan.className = 'stop-name';

                const boldS = document.createElement('span');
                boldS.className = 'first-letter';
                boldS.textContent = 'S';

                const remainingStop = document.createElement('span');
                remainingStop.textContent = 'top: ';

                const stopName = document.createElement('span');
                stopName.className = 'name';
                stopName.textContent = stop.name_en;

                stopSpan.appendChild(boldS);
                stopSpan.appendChild(remainingStop);
                stopSpan.appendChild(stopName);
                
                // Combine all parts
                stopSpan.appendChild(boldS);      // Bold 'S'
                stopSpan.appendChild(remainingStop); // Normal 'top: '
                stopSpan.appendChild(stopName); 
                                
                const etaContainer = document.createElement('div');
                etaContainer.classList.add('eta-container');
                etaContainer.style.display = 'none';
                
                stopInfoContainer.appendChild(distanceSpan);
                stopInfoContainer.appendChild(stopSpan);
                listItem.appendChild(stopInfoContainer);
                listItem.appendChild(etaContainer);
                busStopListElement.appendChild(listItem);
                

                stopSpan.addEventListener('click', async () => {
                    try {
                        const isShowing = etaContainer.style.display !== 'none';
                        if (isShowing) {
                            etaContainer.style.display = 'none';
                            stopInfoContainer.classList.remove('highlighted');
                            highlightedStop = null;
                            currentETAContainer = null;
                            return;
                        }
            
                        // Hide previous ETA container if exists
                        if (currentETAContainer && currentETAContainer !== etaContainer) {
                            currentETAContainer.style.display = 'none';
                        }
            
                        // Remove highlight from previous
                        if (highlightedStop) {
                            highlightedStop.classList.remove('highlighted');
                        }
                        
                        // Update references to current stop
                        stopInfoContainer.classList.add('highlighted');
                        highlightedStop = stopInfoContainer;
                        currentETAContainer = etaContainer;
                    
                        // Show loading state
                        etaContainer.style.display = 'block';
                        
                        // Scroll to show the selected stop
                        listItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        
                        const etaData = await fetchStopETA(stop.stop);
                        
                        // Clear and display ETAs
                        etaContainer.innerHTML = '';
                        
                        if (etaData?.data?.length > 0) {
                            displayETAs(etaData, etaContainer);
                            // Initialize map with the stop's location
                            initMap(stop.lat, stop.long, stop.name_en);
                        } else {
                            etaContainer.textContent = 'No ETA information available';
                        }
                        
                    } catch (error) {
                        console.error("Error fetching ETA:", error);
                        etaContainer.textContent = 'Failed to load ETA data';
                        if (highlightedStop === stopInfoContainer) {
                            stopInfoContainer.classList.remove('highlighted');
                            highlightedStop = null;
                            currentETAContainer = null;
                        }
                    }
                });
            });
        } else {
            messageElement.textContent = 'Cannot locate nearby bus stops';
            console.log("No nearby bus stops found.");
        }
    }, (error) => {
        messageElement.textContent = 'Error getting location: ' + error.message;
        console.log("Geolocation error:", error);
    });
}

// Call findNearbyBusStops when the radius changes
document.getElementById('radius').addEventListener('change', findNearbyBusStops);

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", function() {
    // Load Leaflet CSS
    const leafletCSS = document.createElement('link');
    leafletCSS.rel = 'stylesheet';
    leafletCSS.href = 'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css';
    leafletCSS.integrity = 'sha512-xodZBNTC5n17Xt2atTPuE1HxjVMSvLVW9ocqUKLsCC5CXdbqCmblAshOMAS6/keqq/sMZMZ19scR4PsZChSR7A==';
    leafletCSS.crossOrigin = '';
    document.head.appendChild(leafletCSS);
    
    // Load Leaflet JS
    const leafletJS = document.createElement('script');
    leafletJS.src = 'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js';
    leafletJS.integrity = 'sha512-XQoYMqMTK8LvdxXYG3nZ448hOEQiglfqkJs1NOQV44cWnUrBc8PkAOcXy20w0vlaXaVUearIOBhiXZ5V3ynxwA==';
    leafletJS.crossOrigin = '';
    leafletJS.onload = findNearbyBusStops;
    document.head.appendChild(leafletJS);
});