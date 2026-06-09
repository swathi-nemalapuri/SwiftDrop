// Dynamic Geocoding Cache to prevent duplicate network calls
const geocodingCache = {};

// Fallback Dictionary of Indian Metros for offline/fail-safe operation
const FALLBACK_PINCODES = {
    "110001": { name: "Connaught Place, New Delhi, Delhi", coords: [28.6304, 77.2177] },
    "400001": { name: "Fort, Mumbai, Maharashtra", coords: [18.9400, 72.8350] },
    "600001": { name: "George Town, Chennai, Tamil Nadu", coords: [13.0900, 80.2900] },
    "700001": { name: "B.B.D. Bagh, Kolkata, West Bengal", coords: [22.5726, 88.3439] },
    "560001": { name: "MG Road Area, Bengaluru, Karnataka", coords: [12.9754, 77.6068] },
    "560102": { name: "HSR Layout Sector 1, Bengaluru, Karnataka", coords: [12.9103, 77.6450] },
    "500001": { name: "Afzal Gunj, Hyderabad, Telangana", coords: [17.3753, 78.4744] },
    "380001": { name: "Khadia, Ahmedabad, Gujarat", coords: [23.0246, 72.5948] },
    "400011": { name: "Chinchpokli, Mumbai, Maharashtra", coords: [18.9818, 72.8306] },
    "110020": { name: "Okhla Phase 3, New Delhi, Delhi", coords: [28.5361, 77.2721] }
};

// Mock Driver Database
const MOCK_DRIVERS = [
    { name: "Rohan Sharma", rating: 4.8, vehicleNo: "KA-03-JY-4921", phone: "98765 43210" },
    { name: "Amit Patel", rating: 4.9, vehicleNo: "MH-01-ES-8832", phone: "87654 32109" },
    { name: "Vikram Singh", rating: 4.7, vehicleNo: "DL-3C-MD-1087", phone: "76543 21098" },
    { name: "Suresh Kumar", rating: 4.6, vehicleNo: "TN-02-HK-3456", phone: "91234 56789" }
];

// App State
let state = {
    deliveries: [],
    currentView: 'dashboard',
    activeStep: 1,
    bookingData: {
        pickup: null, // { pincode, area, house, coords }
        dropoff: null, // { pincode, area, house, coords }
        category: '',
        weight: 0.5,
        vehicle: 'bike', // Auto assigned
        deliverySpeed: 'normal', // 'normal', 'speed', 'ultra'
        distance: 0.0,
        fare: 0,
        senderPhone: '9876543210',
        recipientName: '',
        recipientPhone: '',
        paymentMethod: 'bank'
    },
    bankDetails: {
        linked: false,
        bankName: '',
        holderName: '',
        accountNo: '',
        ifsc: '',
        balance: 45000.00,
        pin: '',
        statements: []
    },
    activeOrder: null, // Holds tracking order
    isLightMode: false
};

// Map & Markers Reference
let map;
let pickupMarker;
let dropoffMarker;
let driverMarker;
let routePolyline;
let darkTileLayer;
let lightTileLayer;

// Constants for Map Style
const MAP_DARK_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const MAP_LIGHT_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Simulation States
let simInterval = null;
let simSpeed = 1;
let currentSimRoute = [];
let currentSimIndex = 0;
let simPhase = 'to-pickup'; 

// Enter PIN variables
let enteredPinArray = [];

// -----------------------------------------------------------------------------
// APP INITIALIZATION
// -----------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    loadStateFromStorage();

    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
            const targetView = e.currentTarget.getAttribute("data-view");
            switchView(targetView);
        });
    });

    initMap();
    setupPincodeResolutionListeners();
    setupWizardListeners();

    const themeToggle = document.getElementById("theme-toggle");
    themeToggle.addEventListener("change", (e) => {
        setTheme(e.target.checked ? 'dark' : 'light');
    });

    setupBankListeners();
    setupNumericKeypadListeners();

    renderDashboard();
    updateUIElements();
});

// -----------------------------------------------------------------------------
// MAP FUNCTIONS
// -----------------------------------------------------------------------------
function initMap() {
    // Center of India
    const defaultCenter = [20.5937, 78.9629];
    
    map = L.map('map', {
        zoomControl: false, 
        attributionControl: false
    }).setView(defaultCenter, 5);

    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);

    L.control.attribution({
        position: 'bottomleft'
    }).addTo(map);

    darkTileLayer = L.tileLayer(MAP_DARK_URL, { attribution: MAP_ATTRIBUTION });
    lightTileLayer = L.tileLayer(MAP_LIGHT_URL, { attribution: MAP_ATTRIBUTION });

    darkTileLayer.addTo(map);
}

function setTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.remove('light-theme');
        map.removeLayer(lightTileLayer);
        darkTileLayer.addTo(map);
        state.isLightMode = false;
    } else {
        document.body.classList.add('light-theme');
        map.removeLayer(darkTileLayer);
        lightTileLayer.addTo(map);
        state.isLightMode = true;
    }
}

function createMarkerIcon(type) {
    const className = type === 'pickup' ? 'marker-pin' : 'marker-pin dropoff';
    const iconHtml = `<div class="${className}"></div>`;
    return L.divIcon({
        className: 'custom-div-icon',
        html: iconHtml,
        iconSize: [30, 42],
        iconAnchor: [15, 42]
    });
}

function updateMapRoute() {
    const pickup = state.bookingData.pickup;
    const dropoff = state.bookingData.dropoff;

    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }

    if (!pickup && !dropoff) return;

    const bounds = L.latLngBounds();

    // Update Pickup Marker
    if (pickup) {
        const latLng = L.latLng(pickup.coords);
        bounds.extend(latLng);
        if (pickupMarker) {
            pickupMarker.setLatLng(latLng);
        } else {
            pickupMarker = L.marker(latLng, {
                icon: createMarkerIcon('pickup')
            }).addTo(map);
        }
    } else if (pickupMarker) {
        map.removeLayer(pickupMarker);
        pickupMarker = null;
    }

    // Update Dropoff Marker
    if (dropoff) {
        const latLng = L.latLng(dropoff.coords);
        bounds.extend(latLng);
        if (dropoffMarker) {
            dropoffMarker.setLatLng(latLng);
        } else {
            dropoffMarker = L.marker(latLng, {
                icon: createMarkerIcon('dropoff')
            }).addTo(map);
        }
    } else if (dropoffMarker) {
        map.removeLayer(dropoffMarker);
        dropoffMarker = null;
    }

    // Draw route if both exist
    if (pickup && dropoff) {
        const detailedPath = generateSimulatedRoadRoute(pickup.coords, dropoff.coords);

        routePolyline = L.polyline(detailedPath, {
            color: 'var(--accent)',
            weight: 4,
            dashArray: '8, 8',
            opacity: 0.8
        }).addTo(map);

        map.fitBounds(bounds, { padding: [80, 80] });
    } else {
        const center = pickup ? pickup.coords : dropoff.coords;
        map.setView(center, 12);
    }
}

// -----------------------------------------------------------------------------
// DYNAMIC GEOCODING API FOR ALL OF INDIA
// -----------------------------------------------------------------------------
async function fetchPincodeCoords(pincode) {
    if (geocodingCache[pincode]) {
        return geocodingCache[pincode];
    }

    try {
        const url = `https://nominatim.openstreetmap.org/search?postalcode=${pincode}&country=India&format=json&limit=1`;
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'FlashDashNationalParcelCourierDemo/1.0'
            }
        });
        const data = await response.json();
        if (data && data.length > 0) {
            // Format resolved name
            const rawName = data[0].display_name;
            const split = rawName.split(',');
            // Extract town/subdistrict, district, state
            const cleanName = split.slice(0, Math.min(3, split.length)).join(',').trim();
            const result = {
                name: cleanName,
                coords: [parseFloat(data[0].lat), parseFloat(data[0].lon)]
            };
            geocodingCache[pincode] = result;
            return result;
        }
    } catch (e) {
        console.error("OSM Geocoding API failed, checking local fallbacks.", e);
    }

    // Fallback dictionary check
    if (FALLBACK_PINCODES[pincode]) {
        return FALLBACK_PINCODES[pincode];
    }
    return null;
}

function setupPincodeResolutionListeners() {
    const pickupPin = document.getElementById("pickup-pincode");
    const pickupArea = document.getElementById("pickup-area");
    const pickupHouse = document.getElementById("pickup-house");

    const dropoffPin = document.getElementById("dropoff-pincode");
    const dropoffArea = document.getElementById("dropoff-area");
    const dropoffHouse = document.getElementById("dropoff-house");

    pickupPin.addEventListener("input", async (e) => {
        let pin = e.target.value.replace(/\D/g, ''); 
        e.target.value = pin;
        
        if (pin.length === 6) {
            pickupArea.value = 'Resolving...';
            const resolved = await fetchPincodeCoords(pin);
            
            if (resolved && pin === pickupPin.value) { // Verify pincode hasn't changed since async call
                pickupArea.value = resolved.name;
                pickupHouse.disabled = false;
                pickupHouse.focus();
                
                state.bookingData.pickup = {
                    pincode: pin,
                    area: resolved.name,
                    house: pickupHouse.value,
                    coords: resolved.coords
                };
                updateMapRoute();
                recalculateDistanceAndPrices();
                showToast("Pickup resolved!", "success");
            } else if (!resolved) {
                showToast("Pincode not found. Try e.g. 110001, 400001, 560102", "danger");
                pickupArea.value = '';
                pickupHouse.value = '';
                pickupHouse.disabled = true;
                state.bookingData.pickup = null;
                updateMapRoute();
            }
        } else {
            pickupArea.value = '';
            pickupHouse.value = '';
            pickupHouse.disabled = true;
            state.bookingData.pickup = null;
            updateMapRoute();
        }
    });

    pickupHouse.addEventListener("input", (e) => {
        if (state.bookingData.pickup) {
            state.bookingData.pickup.house = e.target.value;
        }
    });

    dropoffPin.addEventListener("input", async (e) => {
        let pin = e.target.value.replace(/\D/g, ''); 
        e.target.value = pin;

        if (pin.length === 6) {
            dropoffArea.value = 'Resolving...';
            const resolved = await fetchPincodeCoords(pin);

            if (resolved && pin === dropoffPin.value) {
                dropoffArea.value = resolved.name;
                dropoffHouse.disabled = false;
                dropoffHouse.focus();

                state.bookingData.dropoff = {
                    pincode: pin,
                    area: resolved.name,
                    house: dropoffHouse.value,
                    coords: resolved.coords
                };
                updateMapRoute();
                recalculateDistanceAndPrices();
                showToast("Dropoff resolved!", "success");
            } else if (!resolved) {
                showToast("Pincode not found. Try e.g. 110001, 400001, 560102", "danger");
                dropoffArea.value = '';
                dropoffHouse.value = '';
                dropoffHouse.disabled = true;
                state.bookingData.dropoff = null;
                updateMapRoute();
            }
        } else {
            dropoffArea.value = '';
            dropoffHouse.value = '';
            dropoffHouse.disabled = true;
            state.bookingData.dropoff = null;
            updateMapRoute();
        }
    });

    dropoffHouse.addEventListener("input", (e) => {
        if (state.bookingData.dropoff) {
            state.bookingData.dropoff.house = e.target.value;
        }
    });
}

// -----------------------------------------------------------------------------
// DYNAMIC PRICING ENGINE
// -----------------------------------------------------------------------------
function getHaversineDistance(coords1, coords2) {
    const R = 6371; 
    const dLat = (coords2[0] - coords1[0]) * Math.PI / 180;
    const dLng = (coords2[1] - coords1[1]) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(coords1[0] * Math.PI / 180) * Math.cos(coords2[0] * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function calculateFares(distance, weight, speed) {
    // 1. Determine vehicle automatically based on weight and distance threshold
    let vehicle = 'bike';
    if (distance > 50.0) {
        // Distance > 50km forces Cargo Truck delivery across India
        vehicle = 'truck';
    } else {
        if (weight <= 8.0) {
            vehicle = 'bike';
        } else if (weight <= 20.0) {
            vehicle = 'auto';
        } else {
            vehicle = 'truck';
        }
    }

    // 2. Base + Distance rates
    let baseFare = 0;
    let distRate = 0;
    
    if (vehicle === 'bike') {
        baseFare = 40; // Covers first 2 km
        const extraDist = Math.max(0, distance - 2.0);
        distRate = extraDist * 10;
    } else if (vehicle === 'auto') {
        baseFare = 60; // Covers first 2 km
        const extraDist = Math.max(0, distance - 2.0);
        distRate = extraDist * 15;
    } else {
        // Truck
        if (distance > 50.0) {
            // Optimized National Cargo truck rate for long distance (₹18 per km after 5km base)
            baseFare = 200; // Covers first 5 km
            const extraDist = Math.max(0, distance - 5.0);
            distRate = extraDist * 18;
        } else {
            baseFare = 150; // Covers first 3 km
            const extraDist = Math.max(0, distance - 3.0);
            distRate = extraDist * 25;
        }
    }
    
    const baseCourierFare = Math.round(baseFare + distRate);

    // 3. Dynamic Weight-Distance Surcharge (for parcels above 10 kg)
    let weightDistanceSurcharge = 0;
    if (weight > 10.0) {
        const excessWeight = weight - 10.0;
        let ratePerKgPerKm = 3;
        
        if (weight <= 15.0) {
            weightDistanceSurcharge = excessWeight * distance * 3;
        } else if (weight <= 20.0) {
            // 5kg at ₹3/kg/km, rest at ₹5/kg/km
            weightDistanceSurcharge = (5 * distance * 3) + ((weight - 15) * distance * 5);
        } else {
            // 5kg at ₹3, 5kg at ₹5, rest at ₹8
            weightDistanceSurcharge = (5 * distance * 3) + (5 * distance * 5) + ((weight - 20) * distance * 8);
        }
    }
    weightDistanceSurcharge = Math.round(weightDistanceSurcharge);

    // 4. Delivery Speed Surcharge
    let speedAddition = 0;
    let speedMultiplier = 1.0;
    if (speed === 'speed') {
        speedAddition = 50;
        speedMultiplier = 1.2;
    } else if (speed === 'ultra') {
        speedAddition = 120;
        speedMultiplier = 1.5;
    }

    // Total Fare formula: (Base Courier + Weight-Distance) * SpeedMultiplier + SpeedAddition
    const totalFare = Math.round((baseCourierFare + weightDistanceSurcharge) * speedMultiplier + speedAddition);

    // 5. ETAs adjustments based on speed and distance
    let baseETAMins = 15 + Math.round(distance * 1.5); // 1.5 mins per km base
    if (distance > 50.0) {
        baseETAMins = 120 + Math.round(distance * 0.8); // highway speeds
    }

    let finalETA = baseETAMins;
    if (speed === 'speed') finalETA = Math.round(baseETAMins * 0.7);
    if (speed === 'ultra') finalETA = Math.round(baseETAMins * 0.5);

    // Formatting ETA string
    let etaString = `${finalETA} mins`;
    if (finalETA >= 60) {
        const hours = Math.floor(finalETA / 60);
        const mins = finalETA % 60;
        etaString = mins > 0 ? `${hours} hrs ${mins} mins` : `${hours} hrs`;
    }

    return {
        vehicle: vehicle,
        baseCourierFare: baseCourierFare,
        weightDistanceSurcharge: weightDistanceSurcharge,
        speedAddition: speedAddition,
        speedMultiplier: speedMultiplier,
        totalFare: totalFare,
        eta: etaString
    };
}

function recalculateDistanceAndPrices() {
    const pickup = state.bookingData.pickup;
    const dropoff = state.bookingData.dropoff;

    if (!pickup || !dropoff) return;

    // Haversine distance * 1.3 to simulate real road routes
    const rawDist = getHaversineDistance(pickup.coords, dropoff.coords);
    const roadDist = rawDist * 1.3;
    state.bookingData.distance = roadDist;

    const weight = state.bookingData.weight;
    const speed = state.bookingData.deliverySpeed;

    // Calculate dynamic fares
    const pricing = calculateFares(roadDist, weight, speed);
    state.bookingData.vehicle = pricing.vehicle;
    state.bookingData.fare = pricing.totalFare;

    // Render assigned vehicle card
    renderAssignedVehicleCard(pricing);

    // Render fare breakdown
    document.getElementById("summary-distance").textContent = `${roadDist.toFixed(1)} km`;
    document.getElementById("summary-base-charge").textContent = `₹${pricing.baseCourierFare}`;
    document.getElementById("summary-weight-charge").textContent = `₹${pricing.weightDistanceSurcharge}`;
    
    // Speed surcharge label detail: e.g. "+ ₹50 (1.2x)"
    let speedLabel = "₹0 (1.0x)";
    if (speed === 'speed') speedLabel = `+ ₹50 (1.2x)`;
    if (speed === 'ultra') speedLabel = `+ ₹120 (1.5x)`;
    document.getElementById("summary-speed-charge").textContent = speedLabel;

    document.getElementById("summary-total-fare").textContent = `₹${pricing.totalFare}`;
    document.getElementById("checkout-amount").textContent = `₹${pricing.totalFare}`;
}

function renderAssignedVehicleCard(pricing) {
    const container = document.getElementById("assigned-vehicle-container");
    const weight = state.bookingData.weight;
    const distance = state.bookingData.distance;

    let icon = "motorcycle";
    let name = "Flash Bike";
    let desc = "Best for letters, keys, and light parcels.";
    let limits = "Max 8 kg";

    if (pricing.vehicle === 'auto') {
        icon = "rickshaw";
        name = "Flash Auto";
        desc = "Medium loading capacity, suitable for boxes.";
        limits = "Max 20 kg";
    } else if (pricing.vehicle === 'truck') {
        icon = "truck";
        name = distance > 50.0 ? "National Cargo Truck" : "Mini Delivery Truck";
        desc = distance > 50.0 ? "Interstate logistics container transit." : "Large cargo, furniture, and heavy boxes.";
        limits = "Max 50 kg";
    }

    container.innerHTML = `
        <div class="vehicle-card assigned">
            <div class="vehicle-icon">
                <i class="fa-solid fa-${icon}"></i>
            </div>
            <div class="vehicle-details">
                <div class="vehicle-name-row">
                    <span class="vehicle-name">${name}</span>
                    <span class="vehicle-price">₹${pricing.totalFare}</span>
                </div>
                <div class="vehicle-meta">
                    <span><i class="fa-solid fa-clock"></i> ETA: ${pricing.eta}</span>
                    <span><i class="fa-solid fa-weight-scale"></i> ${limits} (Parcel: ${weight.toFixed(1)} kg)</span>
                </div>
                <div style="font-size: 11px; color: var(--text-medium); margin-top: 4px; line-height: 1.3;">
                    ${desc}
                </div>
            </div>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// WIZARD STEP NAVIGATION
// -----------------------------------------------------------------------------
function setupWizardListeners() {
    const weightSlider = document.getElementById("weight-range-slider");
    const weightLabel = document.getElementById("weight-value-lbl");
    const presetButtons = document.querySelectorAll(".weight-presets .preset-btn");

    weightSlider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        weightLabel.textContent = `${val.toFixed(1)} kg`;
        state.bookingData.weight = val;
        
        presetButtons.forEach(btn => btn.classList.remove("active"));
        recalculateDistanceAndPrices();
    });

    presetButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            presetButtons.forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");
            
            const val = parseFloat(e.target.getAttribute("data-val"));
            weightSlider.value = val;
            weightLabel.textContent = `${val.toFixed(1)} kg`;
            state.bookingData.weight = val;
            recalculateDistanceAndPrices();
        });
    });

    // Speed Priority selectors
    document.querySelectorAll(".speed-card").forEach(card => {
        card.addEventListener("click", (e) => {
            document.querySelectorAll(".speed-card").forEach(c => c.classList.remove("selected"));
            e.currentTarget.classList.add("selected");

            state.bookingData.deliverySpeed = e.currentTarget.getAttribute("data-speed");
            recalculateDistanceAndPrices();
        });
    });

    document.getElementById("booking-next-btn").addEventListener("click", handleNextStep);
    document.getElementById("booking-back-btn").addEventListener("click", handleBackStep);
    document.getElementById("booking-cancel-btn").addEventListener("click", () => {
        resetBookingWizard();
        switchView("dashboard");
    });

    // Manual Parcel Category updates
    document.getElementById("parcel-category").addEventListener("input", (e) => {
        state.bookingData.category = e.target.value;
    });

    document.getElementById("recipient-name").addEventListener("input", (e) => {
        state.bookingData.recipientName = e.target.value;
    });
    document.getElementById("recipient-phone").addEventListener("input", (e) => {
        state.bookingData.recipientPhone = e.target.value;
    });
    
    const paymentSelect = document.getElementById("payment-method");
    paymentSelect.addEventListener("change", (e) => {
        state.bookingData.paymentMethod = e.target.value;
        document.getElementById("checkout-method-lbl").textContent = e.target.value === 'bank' ? 'Direct Bank Transfer' : 'Cash on Delivery (COD)';
        toggleBankAlert();
    });
}

function toggleBankAlert() {
    const alert = document.getElementById("bank-payment-alert");
    if (state.bookingData.paymentMethod === 'bank' && !state.bankDetails.linked) {
        alert.style.display = 'block';
    } else {
        alert.style.display = 'none';
    }
}

function handleNextStep() {
    if (state.activeStep === 1) {
        // Validation step 1 (Pincodes + House details)
        const pickup = state.bookingData.pickup;
        const dropoff = state.bookingData.dropoff;

        if (!pickup || !dropoff) {
            showToast("Please enter valid Indian pincodes for pickup and dropoff.", "danger");
            return;
        }
        if (!pickup.house.trim() || !dropoff.house.trim()) {
            showToast("Please fill in specific house, building, or flat address details.", "danger");
            return;
        }
        if (pickup.pincode === dropoff.pincode && pickup.house.trim().toLowerCase() === dropoff.house.trim().toLowerCase()) {
            showToast("Pickup and dropoff addresses cannot be identical.", "danger");
            return;
        }
        
        goToStep(2);
    } else if (state.activeStep === 2) {
        // Validation step 2 (Parcel category manual text validation)
        const categoryVal = document.getElementById("parcel-category").value.trim();
        if (!categoryVal) {
            showToast("Please enter a manual item description of what you are delivering.", "danger");
            return;
        }
        state.bookingData.category = categoryVal;
        goToStep(3);
    } else if (state.activeStep === 3) {
        // Validation step 3
        if (!state.bookingData.vehicle) {
            showToast("Auto vehicle assignment failure. Please check parcel weights.", "danger");
            return;
        }
        goToStep(4);
    } else if (state.activeStep === 4) {
        // Validation step 4
        if (!state.bookingData.recipientName.trim() || !state.bookingData.recipientPhone.trim()) {
            showToast("Please enter recipient name and mobile number.", "danger");
            return;
        }

        // Validate Bank payment selected but bank not linked
        if (state.bookingData.paymentMethod === 'bank') {
            if (!state.bankDetails.linked) {
                showToast("No linked bank account. Please link bank details or select COD.", "danger");
                return;
            }
            if (state.bankDetails.balance < state.bookingData.fare) {
                showToast("Insufficient bank account balance to pay for booking.", "danger");
                return;
            }

            openPinAuthModal();
        } else {
            confirmBooking();
        }
    }
}

function handleBackStep() {
    if (state.activeStep > 1) {
        goToStep(state.activeStep - 1);
    }
}

function goToStep(stepNumber) {
    state.activeStep = stepNumber;
    
    for (let i = 1; i <= 4; i++) {
        document.getElementById(`booking-step-${i}`).style.display = i === stepNumber ? 'block' : 'none';
        
        const dot = document.getElementById(`step-${i}-dot`);
        if (i < stepNumber) {
            dot.className = "step completed";
            dot.innerHTML = '<i class="fa-solid fa-check"></i>';
        } else if (i === stepNumber) {
            dot.className = "step active";
            dot.innerHTML = i;
        } else {
            dot.className = "step";
            dot.innerHTML = i;
        }
    }

    const progressWidth = ((stepNumber - 1) / 3) * 100;
    document.getElementById("step-progress-bar").style.width = `${progressWidth}%`;

    document.getElementById("booking-step-indicator").textContent = `Step ${stepNumber} of 4`;
    document.getElementById("booking-back-btn").style.display = stepNumber === 1 ? 'none' : 'block';
    
    const nextBtn = document.getElementById("booking-next-btn");
    if (stepNumber === 4) {
        nextBtn.innerHTML = `<span>Book Now</span> <i class="fa-solid fa-paper-plane"></i>`;
        toggleBankAlert();
    } else {
        nextBtn.innerHTML = `<span>Next</span> <i class="fa-solid fa-arrow-right"></i>`;
    }
}

function resetBookingWizard() {
    state.activeStep = 1;
    state.bookingData.pickup = null;
    state.bookingData.dropoff = null;
    state.bookingData.vehicle = 'bike';
    state.bookingData.deliverySpeed = 'normal';
    state.bookingData.recipientName = '';
    state.bookingData.recipientPhone = '';
    state.bookingData.category = '';
    
    document.getElementById("pickup-pincode").value = '';
    document.getElementById("pickup-area").value = '';
    document.getElementById("pickup-house").value = '';
    document.getElementById("pickup-house").disabled = true;

    document.getElementById("dropoff-pincode").value = '';
    document.getElementById("dropoff-area").value = '';
    document.getElementById("dropoff-house").value = '';
    document.getElementById("dropoff-house").disabled = true;

    document.getElementById("parcel-category").value = '';

    document.getElementById("recipient-name").value = '';
    document.getElementById("recipient-phone").value = '';
    document.getElementById("weight-range-slider").value = 0.5;
    document.getElementById("weight-value-lbl").textContent = "0.5 kg";
    
    document.querySelectorAll(".weight-presets .preset-btn").forEach((btn, index) => {
        if (index === 0) btn.classList.add("active");
        else btn.classList.remove("active");
    });

    document.querySelectorAll(".speed-card").forEach((card, index) => {
        if (index === 0) card.classList.add("selected");
        else card.classList.remove("selected");
    });

    if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
    if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; }
    if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }

    goToStep(1);
}

// -----------------------------------------------------------------------------
// BANK DETAILS & PERSISTENCE
// -----------------------------------------------------------------------------
function setupBankListeners() {
    const linkBtn = document.getElementById("bank-link-submit-btn");
    const unlinkBtn = document.getElementById("bank-unlink-btn");
    const depositBtn = document.getElementById("bank-demo-deposit-btn");

    linkBtn.addEventListener("click", () => {
        const bankName = document.getElementById("bank-name-select").value;
        const holderName = document.getElementById("bank-holder-input").value;
        const accountNo = document.getElementById("bank-account-input").value;
        const ifsc = document.getElementById("bank-ifsc-input").value;
        const pin = document.getElementById("bank-pin-input").value;

        if (!holderName.trim() || !accountNo.trim() || !ifsc.trim() || pin.length !== 4 || isNaN(pin)) {
            showToast("Please enter all details. Secure UPI PIN must be exactly 4 digits.", "danger");
            return;
        }

        state.bankDetails = {
            linked: true,
            bankName: bankName,
            holderName: holderName,
            accountNo: accountNo,
            ifsc: ifsc,
            balance: 45000.00,
            pin: pin,
            statements: [
                { type: 'credit', desc: 'Mock Initial Setup Balance', amount: 45000, date: new Date().toLocaleDateString() }
            ]
        };

        saveStateToStorage();
        updateUIElements();
        renderBankView();
        showToast("Bank account linked successfully!", "success");
    });

    unlinkBtn.addEventListener("click", () => {
        state.bankDetails = {
            linked: false,
            bankName: '',
            holderName: '',
            accountNo: '',
            ifsc: '',
            balance: 0.0,
            pin: '',
            statements: []
        };
        saveStateToStorage();
        updateUIElements();
        renderBankView();
        showToast("Bank account unlinked.", "success");
    });

    depositBtn.addEventListener("click", () => {
        state.bankDetails.balance += 5000.00;
        state.bankDetails.statements.unshift({
            type: 'credit',
            desc: 'Self Deposit (Demo)',
            amount: 5000,
            date: new Date().toLocaleDateString()
        });
        saveStateToStorage();
        updateUIElements();
        renderBankView();
        showToast("₹5000.00 deposited successfully!", "success");
    });
}

function renderBankView() {
    const setupForm = document.getElementById("bank-setup-form-container");
    const linkedDetails = document.getElementById("bank-details-container");

    if (state.bankDetails.linked) {
        setupForm.style.display = 'none';
        linkedDetails.style.display = 'flex';

        document.getElementById("card-bank-name-lbl").textContent = state.bankDetails.bankName;
        
        const acc = state.bankDetails.accountNo;
        const hiddenAcc = acc.length > 4 ? `XXXX XXXX XXXX ${acc.substring(acc.length - 4)}` : `XXXX XXXX ${acc}`;
        document.getElementById("card-number-lbl").textContent = hiddenAcc;
        
        document.getElementById("card-holder-lbl").textContent = state.bankDetails.holderName;
        document.getElementById("card-balance-lbl").textContent = `₹${state.bankDetails.balance.toLocaleString('en-IN', {minimumFractionDigits: 2})}`;

        renderBankStatementList();
    } else {
        setupForm.style.display = 'flex';
        linkedDetails.style.display = 'none';
        document.getElementById("bank-pin-input").value = '';
    }
}

function renderBankStatementList() {
    const list = document.getElementById("bank-statement-list");
    list.innerHTML = '';

    if (state.bankDetails.statements.length === 0) {
        list.innerHTML = `<p style="color:var(--text-muted); font-size:12px; text-align:center; padding:15px;">No transactions yet.</p>`;
        return;
    }

    state.bankDetails.statements.forEach(stmt => {
        const item = document.createElement("div");
        item.className = "history-item";
        item.style.padding = "10px 14px";
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:13px; font-weight:600;">${stmt.desc}</div>
                    <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${stmt.date}</div>
                </div>
                <div style="font-weight:700; color: ${stmt.type === 'credit' ? 'var(--secondary)' : 'var(--danger)'}">
                    ${stmt.type === 'credit' ? '+' : '-'} ₹${stmt.amount}
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

// -----------------------------------------------------------------------------
// SECURE UPI PIN MODAL LOGIC
// -----------------------------------------------------------------------------
function openPinAuthModal() {
    const modal = document.getElementById("pin-auth-modal");
    modal.classList.add("active");

    enteredPinArray = [];
    updatePinDotsVisual();
    document.getElementById("pin-error-badge").style.display = 'none';

    document.getElementById("pin-modal-amount-lbl").textContent = `Authorizing transaction of ₹${state.bookingData.fare}`;
    
    const acc = state.bankDetails.accountNo;
    const last4 = acc.substring(acc.length - 4);
    document.getElementById("pin-modal-bank-lbl").textContent = `From ${state.bankDetails.bankName} (**** ${last4})`;
}

function closePinAuthModal() {
    document.getElementById("pin-auth-modal").classList.remove("active");
}

function setupNumericKeypadListeners() {
    document.querySelectorAll(".key-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const key = e.currentTarget.getAttribute("data-key");
            handlePinKeyPress(key);
        });
    });

    document.addEventListener("keydown", (e) => {
        const modal = document.getElementById("pin-auth-modal");
        if (!modal.classList.contains("active")) return;

        if (e.key >= '0' && e.key <= '9') {
            handlePinKeyPress(e.key);
        } else if (e.key === 'Backspace') {
            handlePinKeyPress('backspace');
        } else if (e.key === 'Escape') {
            closePinAuthModal();
        } else if (e.key === 'Enter') {
            validateAndSubmitPin();
        }
    });

    document.getElementById("pin-cancel-btn").addEventListener("click", closePinAuthModal);
    document.getElementById("pin-submit-btn").addEventListener("click", validateAndSubmitPin);
}

function handlePinKeyPress(key) {
    document.getElementById("pin-error-badge").style.display = 'none';

    if (key === 'clear') {
        enteredPinArray = [];
    } else if (key === 'backspace') {
        enteredPinArray.pop();
    } else {
        if (enteredPinArray.length < 4) {
            enteredPinArray.push(key);
        }
    }
    updatePinDotsVisual();
}

function updatePinDotsVisual() {
    for (let i = 1; i <= 4; i++) {
        const dot = document.getElementById(`pin-dot-${i}`);
        if (i <= enteredPinArray.length) {
            dot.classList.add("filled");
        } else {
            dot.classList.remove("filled");
        }
    }
}

function validateAndSubmitPin() {
    const enteredPinStr = enteredPinArray.join('');
    
    if (enteredPinStr.length !== 4) {
        showToast("Please enter complete 4-digit secure PIN.", "danger");
        return;
    }

    if (enteredPinStr === state.bankDetails.pin) {
        const fare = state.bookingData.fare;
        state.bankDetails.balance -= fare;
        
        state.bankDetails.statements.unshift({
            type: 'debit',
            desc: `FlashDash Booking Payment`,
            amount: fare,
            date: new Date().toLocaleDateString()
        });

        saveStateToStorage();
        updateUIElements();
        renderBankView();
        
        closePinAuthModal();
        confirmBooking();
    } else {
        const card = document.querySelector(".pin-modal-card");
        card.classList.add("shake-error");
        document.getElementById("pin-error-badge").style.display = 'block';

        enteredPinArray = [];
        updatePinDotsVisual();

        setTimeout(() => {
            card.classList.remove("shake-error");
        }, 500);
    }
}

// -----------------------------------------------------------------------------
// CONFIRM BOOKING & SIMULATION ANIMATOR
// -----------------------------------------------------------------------------
function confirmBooking() {
    const orderId = "FDS-" + Math.floor(100000 + Math.random() * 900000);
    
    const pickupName = `${state.bookingData.pickup.house}, resolved at ${state.bookingData.pickup.area} (${state.bookingData.pickup.pincode})`;
    const dropoffName = `${state.bookingData.dropoff.house}, resolved at ${state.bookingData.dropoff.area} (${state.bookingData.dropoff.pincode})`;

    state.activeOrder = {
        id: orderId,
        pickup: { name: pickupName, coords: state.bookingData.pickup.coords },
        dropoff: { name: dropoffName, coords: state.bookingData.dropoff.coords },
        category: state.bookingData.category,
        weight: state.bookingData.weight,
        vehicle: state.bookingData.vehicle,
        deliverySpeed: state.bookingData.deliverySpeed,
        fare: state.bookingData.fare,
        senderPhone: state.bookingData.senderPhone,
        recipientName: state.bookingData.recipientName,
        recipientPhone: state.bookingData.recipientPhone,
        paymentMethod: state.bookingData.paymentMethod,
        date: new Date().toLocaleDateString(),
        status: 'searching'
    };

    showToast("Booking request sent!", "success");

    document.getElementById("nav-track-active").style.display = 'flex';
    switchView("tracking");

    startSimulationDispatcher();
}

function startSimulationDispatcher() {
    document.getElementById("tracking-order-id").textContent = `ID: #${state.activeOrder.id}`;
    document.getElementById("tracking-search-state").style.display = 'flex';
    document.getElementById("tracking-active-state").style.display = 'none';
    
    document.getElementById("tracking-search-fare").textContent = `₹${state.activeOrder.fare}`;
    
    // priority speed title mapping
    let speedTitle = "Normal";
    if (state.activeOrder.deliverySpeed === 'speed') speedTitle = "Speed Priority";
    if (state.activeOrder.deliverySpeed === 'ultra') speedTitle = "Ultra Fast";
    
    document.getElementById("tracking-search-class").textContent = `${state.activeOrder.category} (${state.activeOrder.weight.toFixed(1)} kg) - ${speedTitle}`;

    document.getElementById("cancel-matching-btn").onclick = () => {
        cancelActiveOrder();
    };

    simInterval = setTimeout(() => {
        assignDriverToOrder();
    }, 3500);
}

function assignDriverToOrder() {
    const randomDriver = MOCK_DRIVERS[Math.floor(Math.random() * MOCK_DRIVERS.length)];
    state.activeOrder.driver = randomDriver;
    state.activeOrder.status = 'assigned';

    document.getElementById("tracking-search-state").style.display = 'none';
    const activeSection = document.getElementById("tracking-active-state");
    activeSection.style.display = 'flex';

    document.getElementById("driver-name").textContent = randomDriver.name;
    document.getElementById("driver-rating-val").textContent = randomDriver.rating;
    document.getElementById("driver-vehicle-no").textContent = randomDriver.vehicleNo;
    
    let vehicleName = "Flash Bike";
    if (state.activeOrder.vehicle === 'auto') vehicleName = "Flash Auto";
    if (state.activeOrder.vehicle === 'truck') {
        vehicleName = state.bookingData.distance > 50.0 ? "National Cargo Truck" : "Delivery Truck";
    }
    document.getElementById("driver-vehicle-type").textContent = vehicleName;

    resetTrackingTimeline();
    document.getElementById("track-step-1").className = "timeline-step completed";
    const step2 = document.getElementById("track-step-2");
    step2.className = "timeline-step active";
    step2.querySelector("div").textContent = "Driver arriving at pickup";

    showToast("Driver assigned!", "success");

    const pickupCoords = state.activeOrder.pickup.coords;
    const startOffset = [0.015 * (Math.random() - 0.5), 0.015 * (Math.random() - 0.5)];
    const driverStartLoc = [pickupCoords[0] + startOffset[0], pickupCoords[1] + startOffset[1]];

    if (driverMarker) map.removeLayer(driverMarker);
    
    const driverIconHtml = `
        <div class="driver-marker-icon">
            <i class="fa-solid fa-${state.activeOrder.vehicle === 'bike' ? 'motorcycle' : state.activeOrder.vehicle === 'auto' ? 'rickshaw' : 'truck'}"></i>
        </div>
    `;
    const driverIcon = L.divIcon({
        className: 'custom-div-icon',
        html: driverIconHtml,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });

    driverMarker = L.marker(driverStartLoc, { icon: driverIcon }).addTo(map);

    const toPickupRoute = generateSimulatedRoadRoute(driverStartLoc, pickupCoords, 20);

    // Adjust simulator speed baseline if it's high priority
    let baseSpeed = 1;
    if (state.activeOrder.deliverySpeed === 'speed') baseSpeed = 2;
    if (state.activeOrder.deliverySpeed === 'ultra') baseSpeed = 4;
    
    simSpeed = baseSpeed;
    updateSimControlsUI();

    document.getElementById("sim-speedup-btn").onclick = () => {
        simSpeed = simSpeed === baseSpeed ? baseSpeed * 3 : simSpeed === baseSpeed * 3 ? baseSpeed * 6 : baseSpeed;
        updateSimControlsUI();
    };

    document.getElementById("sim-complete-btn").onclick = () => {
        instantDeliverSimulation();
    };

    startRouteTrackingAnimation(toPickupRoute, 'to-pickup');
}

function updateSimControlsUI() {
    const btn = document.getElementById("sim-speedup-btn");
    btn.innerHTML = `<i class="fa-solid fa-forward"></i> Speed ${simSpeed}x`;
}

function startRouteTrackingAnimation(routePoints, phase) {
    currentSimRoute = routePoints;
    currentSimIndex = 0;
    simPhase = phase;

    if (simInterval) clearInterval(simInterval);

    animateSimTick();
}

function animateSimTick() {
    if (state.activeOrder === null) return;

    if (currentSimIndex >= currentSimRoute.length) {
        handleSimulationPhaseEnd();
        return;
    }

    const nextCoord = currentSimRoute[currentSimIndex];
    if (driverMarker) {
        driverMarker.setLatLng(nextCoord);
        if (state.currentView === 'tracking') {
            map.panTo(nextCoord);
        }
    }

    currentSimIndex++;
    const tickDelay = 1000 / simSpeed;

    simInterval = setTimeout(animateSimTick, tickDelay);
}

function handleSimulationPhaseEnd() {
    if (simPhase === 'to-pickup') {
        document.getElementById("track-step-2").className = "timeline-step completed";
        document.getElementById("track-step-2").querySelector("div").textContent = "Driver arrived at Pickup";
        
        const step3 = document.getElementById("track-step-3");
        step3.className = "timeline-step active";
        step3.querySelector("div").textContent = "Collecting your package...";

        simPhase = 'waiting-pickup';
        simInterval = setTimeout(() => {
            document.getElementById("track-step-3").className = "timeline-step completed";
            document.getElementById("track-step-3").querySelector("div").textContent = "Package collected by driver";
            
            const step4 = document.getElementById("track-step-4");
            step4.className = "timeline-step active";
            step4.querySelector("div").textContent = "Out for Delivery";

            const pickupCoords = state.activeOrder.pickup.coords;
            const dropoffCoords = state.activeOrder.dropoff.coords;
            const deliveryRoute = generateSimulatedRoadRoute(pickupCoords, dropoffCoords, 35);
            
            const bounds = L.latLngBounds([pickupCoords, dropoffCoords]);
            map.fitBounds(bounds, { padding: [60, 60] });

            startRouteTrackingAnimation(deliveryRoute, 'to-dropoff');
        }, 3000 / simSpeed);

    } else if (simPhase === 'to-dropoff') {
        document.getElementById("track-step-4").className = "timeline-step completed";
        
        const step5 = document.getElementById("track-step-5");
        step5.className = "timeline-step completed";
        step5.querySelector("div").textContent = "Delivered successfully";

        state.activeOrder.status = 'delivered';
        
        showToast("Package delivered successfully!", "success");

        state.deliveries.unshift(state.activeOrder);
        state.activeOrder = null;
        document.getElementById("nav-track-active").style.display = 'none';

        if (driverMarker) {
            map.removeLayer(driverMarker);
            driverMarker = null;
        }

        saveStateToStorage();
        renderDashboard();
        updateUIElements();

        setTimeout(() => {
            if (state.activeOrder === null) { 
                switchView("history");
                resetBookingWizard();
            }
        }, 3000);
    }
}

function instantDeliverSimulation() {
    if (simInterval) {
        clearTimeout(simInterval);
        clearInterval(simInterval);
    }

    if (!state.activeOrder) return;

    document.getElementById("track-step-1").className = "timeline-step completed";
    document.getElementById("track-step-2").className = "timeline-step completed";
    document.getElementById("track-step-3").className = "timeline-step completed";
    document.getElementById("track-step-4").className = "timeline-step completed";
    
    const step5 = document.getElementById("track-step-5");
    step5.className = "timeline-step completed";
    step5.querySelector("div").textContent = "Delivered successfully";

    state.activeOrder.status = 'delivered';
    
    if (driverMarker) {
        driverMarker.setLatLng(state.activeOrder.dropoff.coords);
    }

    showToast("Package delivered (Simulation skipped)!", "success");

    state.deliveries.unshift(state.activeOrder);
    state.activeOrder = null;
    document.getElementById("nav-track-active").style.display = 'none';

    if (driverMarker) {
        map.removeLayer(driverMarker);
        driverMarker = null;
    }

    saveStateToStorage();
    renderDashboard();
    updateUIElements();

    setTimeout(() => {
        switchView("history");
        resetBookingWizard();
    }, 2000);
}

function cancelActiveOrder() {
    if (simInterval) {
        clearTimeout(simInterval);
        clearInterval(simInterval);
    }

    if (!state.activeOrder) return;

    if (state.activeOrder.paymentMethod === 'bank') {
        state.bankDetails.balance += state.activeOrder.fare;
        state.bankDetails.statements.unshift({
            type: 'credit',
            desc: `Refund: Cancelled Booking`,
            amount: state.activeOrder.fare,
            date: new Date().toLocaleDateString()
        });
        showToast("Booking cancelled. Refund credited to bank.", "success");
    } else {
        showToast("Booking cancelled successfully.", "success");
    }

    state.activeOrder.status = 'cancelled';
    state.deliveries.unshift(state.activeOrder);
    
    state.activeOrder = null;
    document.getElementById("nav-track-active").style.display = 'none';

    if (driverMarker) {
        map.removeLayer(driverMarker);
        driverMarker = null;
    }

    saveStateToStorage();
    renderDashboard();
    updateUIElements();

    switchView("dashboard");
    resetBookingWizard();
}

function resetTrackingTimeline() {
    for (let i = 1; i <= 5; i++) {
        const step = document.getElementById(`track-step-${i}`);
        step.className = "timeline-step";
    }
}

function generateSimulatedRoadRoute(start, end, steps = 30) {
    const points = [];
    points.push(start);

    const latDiff = end[0] - start[0];
    const lngDiff = end[1] - start[1];

    const midPoint1 = [start[0] + latDiff * 0.45, start[1] + lngDiff * 0.1];
    const midPoint2 = [start[0] + latDiff * 0.55, end[1] - lngDiff * 0.1];

    const seg1Steps = Math.floor(steps * 0.3);
    for (let i = 1; i <= seg1Steps; i++) {
        const ratio = i / seg1Steps;
        points.push([
            start[0] + (midPoint1[0] - start[0]) * ratio,
            start[1] + (midPoint1[1] - start[1]) * ratio
        ]);
    }

    const seg2Steps = Math.floor(steps * 0.3);
    for (let i = 1; i <= seg2Steps; i++) {
        const ratio = i / seg2Steps;
        points.push([
            midPoint1[0] + (midPoint2[0] - midPoint1[0]) * ratio,
            midPoint1[1] + (midPoint2[1] - midPoint1[1]) * ratio
        ]);
    }

    const seg3Steps = steps - seg1Steps - seg2Steps;
    for (let i = 1; i <= seg3Steps; i++) {
        const ratio = i / seg3Steps;
        points.push([
            midPoint2[0] + (end[0] - midPoint2[0]) * ratio,
            midPoint2[1] + (end[1] - midPoint2[1]) * ratio
        ]);
    }

    return points;
}

// -----------------------------------------------------------------------------
// VIEWS ROUTING SYSTEM
// -----------------------------------------------------------------------------
function switchView(viewName) {
    state.currentView = viewName;

    document.querySelectorAll(".nav-item").forEach(item => {
        if (item.getAttribute("data-view") === viewName) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });

    document.querySelectorAll(".view-panel").forEach(panel => {
        if (panel.id === `${viewName}-view`) {
            panel.classList.add("active");
        } else {
            panel.classList.remove("active");
        }
    });

    closePinAuthModal();

    if (viewName === 'dashboard') {
        renderDashboard();
        if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
        if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; }
        if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
        // Center India
        map.setView([20.5937, 78.9629], 5);
    } 
    else if (viewName === 'booking') {
        resetBookingWizard();
        updateMapRoute();
    }
    else if (viewName === 'tracking') {
        if (state.activeOrder) {
            const pickupCoords = state.activeOrder.pickup.coords;
            const dropoffCoords = state.activeOrder.dropoff.coords;
            
            if (routePolyline) map.removeLayer(routePolyline);
            
            const detailedPath = generateSimulatedRoadRoute(pickupCoords, dropoffCoords);
            routePolyline = L.polyline(detailedPath, {
                color: 'var(--accent)',
                weight: 4,
                dashArray: '8, 8',
                opacity: 0.8
            }).addTo(map);

            if (pickupMarker) map.removeLayer(pickupMarker);
            pickupMarker = L.marker(pickupCoords, { icon: createMarkerIcon('pickup') }).addTo(map);

            if (dropoffMarker) map.removeLayer(dropoffMarker);
            dropoffMarker = L.marker(dropoffCoords, { icon: createMarkerIcon('dropoff') }).addTo(map);

            const bounds = L.latLngBounds([pickupCoords, dropoffCoords]);
            map.fitBounds(bounds, { padding: [60, 60] });
        }
    }
    else if (viewName === 'history') {
        renderHistory();
        if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
        if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; }
        if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
    }
    else if (viewName === 'bank') {
        renderBankView();
        if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
        if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; }
        if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
    }
}

// -----------------------------------------------------------------------------
// RENDER VIEWS & UI UPDATES
// -----------------------------------------------------------------------------
function renderDashboard() {
    const list = document.getElementById("dashboard-recent-list");
    list.innerHTML = '';

    const completedTrips = state.deliveries.filter(d => d.status === 'delivered');
    document.getElementById("stat-trips").textContent = completedTrips.length;
    
    const totalSpent = completedTrips.reduce((acc, current) => acc + current.fare, 0);
    document.getElementById("stat-spent").textContent = `₹${totalSpent}`;

    const recent = state.deliveries.slice(0, 3);
    
    if (recent.length === 0) {
        list.innerHTML = `<p style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">No recent deliveries. Start by booking one!</p>`;
        return;
    }

    recent.forEach(d => {
        const item = document.createElement("div");
        item.className = "history-item";
        
        // Extract area city only
        const shortPickup = d.pickup.name.includes("resolved at") ? d.pickup.name.split("resolved at")[1].trim().split(',')[0] : d.pickup.name.split(',')[0];
        const shortDropoff = d.dropoff.name.includes("resolved at") ? d.dropoff.name.split("resolved at")[1].trim().split(',')[0] : d.dropoff.name.split(',')[0];

        item.innerHTML = `
            <div class="history-header">
                <span>ID: #${d.id}</span>
                <span>${d.date}</span>
            </div>
            <div class="history-route">
                <span style="color: var(--primary); font-size: 12px;"><i class="fa-solid fa-circle"></i></span>
                <span style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size:13px;" title="${d.pickup.name}">${shortPickup}</span>
                <span style="color: var(--text-muted); font-size: 11px;"><i class="fa-solid fa-arrow-right-long"></i></span>
                <span style="color: var(--accent); font-size: 12px;"><i class="fa-solid fa-location-dot"></i></span>
                <span style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size:13px;" title="${d.dropoff.name}">${shortDropoff}</span>
            </div>
            <div class="history-meta" style="margin-top: 6px;">
                <span class="status-badge ${d.status}">${d.status}</span>
                <span class="history-price">₹${d.fare}</span>
            </div>
        `;
        list.appendChild(item);
    });
}

function renderHistory() {
    const container = document.getElementById("history-list-container");
    container.innerHTML = '';

    if (state.deliveries.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">No delivery history found.</p>`;
        return;
    }

    state.deliveries.forEach(d => {
        const item = document.createElement("div");
        item.className = "history-item";
        
        let vehicleIcon = "motorcycle";
        if (d.vehicle === 'auto') vehicleIcon = "rickshaw";
        if (d.vehicle === 'truck') vehicleIcon = "truck";

        item.innerHTML = `
            <div class="history-header">
                <span>ID: #${d.id}</span>
                <span>${d.date}</span>
            </div>
            <div class="history-route">
                <span style="color: var(--primary); font-size: 10px;"><i class="fa-solid fa-circle"></i></span>
                <span style="font-size:13px;">${d.pickup.name}</span>
            </div>
            <div class="history-route" style="margin-top: 4px;">
                <span style="color: var(--accent); font-size: 10px;"><i class="fa-solid fa-location-dot"></i></span>
                <span style="font-size:13px;">${d.dropoff.name}</span>
            </div>
            <div style="height:1px; background: rgba(255,255,255,0.04); margin: 10px 0;"></div>
            <div class="history-meta">
                <div style="display:flex; align-items:center; gap: 8px;">
                    <span class="status-badge ${d.status}">${d.status}</span>
                    <span style="font-size:11px; color: var(--text-muted);">
                        <i class="fa-solid fa-${vehicleIcon}"></i> ${d.category} (${d.weight} kg) - ${d.deliverySpeed.toUpperCase()}
                    </span>
                </div>
                <span class="history-price">₹${d.fare}</span>
            </div>
        `;
        container.appendChild(item);
    });
}

function updateUIElements() {
    const sidebarStatus = document.getElementById("sidebar-bank-status-lbl");
    const sidebarDisplay = document.getElementById("sidebar-bank-display");
    const sidebarBtn = document.getElementById("sidebar-bank-action-btn");

    if (state.bankDetails.linked) {
        sidebarStatus.textContent = `${state.bankDetails.bankName} Linked`;
        sidebarDisplay.textContent = `₹${state.bankDetails.balance.toLocaleString('en-IN', {maximumFractionDigits: 0})}`;
        sidebarBtn.innerHTML = `<i class="fa-solid fa-credit-card"></i> Manage Bank`;
    } else {
        sidebarStatus.textContent = "Bank Not Linked";
        sidebarDisplay.textContent = "₹0.00";
        sidebarBtn.innerHTML = `<i class="fa-solid fa-link"></i> Link Bank`;
    }
}

// -----------------------------------------------------------------------------
// MOCK NOTIFICATIONS (TOASTS)
// -----------------------------------------------------------------------------
function showToast(message, type = 'success') {
    const toast = document.getElementById("toast-notification");
    const toastText = document.getElementById("toast-text");
    const toastIcon = toast.querySelector("i");

    toastText.textContent = message;
    
    toast.className = `notification-banner active ${type}`;
    if (type === 'success') {
        toastIcon.className = "fa-solid fa-circle-check";
        toastIcon.style.color = "var(--secondary)";
    } else {
        toastIcon.className = "fa-solid fa-circle-xmark";
        toastIcon.style.color = "var(--danger)";
    }

    setTimeout(() => {
        toast.classList.remove("active");
    }, 3500);
}

// -----------------------------------------------------------------------------
// LOCAL STORAGE PERSISTENCE
// -----------------------------------------------------------------------------
function saveStateToStorage() {
    localStorage.setItem("flashdash_bank_details", JSON.stringify(state.bankDetails));
    localStorage.setItem("flashdash_deliveries", JSON.stringify(state.deliveries));
}

function loadStateFromStorage() {
    const savedBank = localStorage.getItem("flashdash_bank_details");
    if (savedBank !== null) {
        state.bankDetails = JSON.parse(savedBank);
    }

    const savedDeliveries = localStorage.getItem("flashdash_deliveries");
    if (savedDeliveries !== null) {
        state.deliveries = JSON.parse(savedDeliveries);
    }
}
