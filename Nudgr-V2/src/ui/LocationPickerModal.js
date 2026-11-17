import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import RadiusSlider from './RadiusSlider';

function buildLeafletHtml(initialLat, initialLon, initialRadiusKm) {
  const lat = Number.isFinite(initialLat) ? initialLat : 12.9716;
  const lon = Number.isFinite(initialLon) ? initialLon : 77.5946;
  const radiusM = (Number.isFinite(initialRadiusKm) ? initialRadiusKm : 5.0) * 1000;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #EEF2FF; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .custom-pin {
      width: 26px; height: 26px; border-radius: 50%;
      background: #6366F1; border: 3px solid #FFFFFF;
      box-shadow: 0 4px 12px rgba(99,102,241,0.45);
    }
    .leaflet-control-attribution { font-size: 9px; opacity: 0.7; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var curLat = ${lat};
    var curLon = ${lon};
    var curRadiusM = ${radiusM};

    var map = L.map('map', { zoomControl: true }).setView([curLat, curLon], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    var pinIcon = L.divIcon({
      className: '',
      html: '<div class="custom-pin"></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    var marker = L.marker([curLat, curLon], { draggable: true, icon: pinIcon }).addTo(map);
    var circle = L.circle([curLat, curLon], {
      radius: curRadiusM,
      color: '#6366F1',
      weight: 2,
      fillColor: '#6366F1',
      fillOpacity: 0.14
    }).addTo(map);

    function emitPin(lat, lon) {
      curLat = lat;
      curLon = lon;
      marker.setLatLng([lat, lon]);
      circle.setLatLng([lat, lon]);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'PIN_MOVED',
          latitude: Number(lat.toFixed(6)),
          longitude: Number(lon.toFixed(6))
        }));
      }
    }

    map.on('click', function(e) {
      emitPin(e.latlng.lat, e.latlng.lng);
    });

    marker.on('dragend', function(e) {
      var pos = marker.getLatLng();
      emitPin(pos.lat, pos.lng);
    });

    window.updatePinAndRadius = function(lat, lon, radiusKm, recenter) {
      if (typeof lat === 'number' && typeof lon === 'number') {
        curLat = lat;
        curLon = lon;
        marker.setLatLng([lat, lon]);
        circle.setLatLng([lat, lon]);
        if (recenter) {
          map.setView([lat, lon], map.getZoom());
        }
      }
      if (typeof radiusKm === 'number') {
        curRadiusM = radiusKm * 1000;
        circle.setRadius(curRadiusM);
      }
    };
  </script>
</body>
</html>`;
}

/**
 * Interactive OpenStreetMap + Leaflet Location Picker Modal (Option A).
 * Allows tapping/dragging to pin any destination, searching places via expo-location
 * geocoding, and previewing the exact geofence radius circle on the map.
 */
export default function LocationPickerModal({
  visible,
  initialTrigger,
  radiusKm = 5.0,
  onRadiusChange,
  onConfirm,
  onClose,
}) {
  const webViewRef = useRef(null);
  const [lat, setLat] = useState(initialTrigger?.latitude ?? 12.9716);
  const [lon, setLon] = useState(initialTrigger?.longitude ?? 77.5946);
  const [label, setLabel] = useState(initialTrigger?.label || 'Pinned location');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [localRadiusKm, setLocalRadiusKm] = useState(radiusKm || 5.0);

  const reverseLookup = useCallback(async (latitude, longitude) => {
    try {
      const results = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (results && results.length > 0) {
        const place = results[0];
        const parts = [
          place.name || place.street,
          place.district || place.subregion || place.city,
        ].filter(Boolean);
        if (parts.length > 0) {
          setLabel(parts.slice(0, 2).join(', '));
          return;
        }
      }
    } catch (_) {}
    setLabel(`Pin (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setLocalRadiusKm(radiusKm || 5.0);
    setStatusError(null);
    if (
      initialTrigger &&
      typeof initialTrigger.latitude === 'number' &&
      typeof initialTrigger.longitude === 'number' &&
      (initialTrigger.latitude !== 0 || initialTrigger.longitude !== 0)
    ) {
      setLat(initialTrigger.latitude);
      setLon(initialTrigger.longitude);
      setLabel(initialTrigger.label || 'Pinned location');
    } else {
      // Center on current GPS if available
      (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.status === 'granted') {
            const current = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
              mayShowUserSettingsDialog: false,
            });
            if (current?.coords) {
              const cLat = current.coords.latitude;
              const cLon = current.coords.longitude;
              setLat(cLat);
              setLon(cLon);
              webViewRef.current?.injectJavaScript(
                `window.updatePinAndRadius && window.updatePinAndRadius(${cLat}, ${cLon}, ${radiusKm || 5.0}, true); true;`
              );
              reverseLookup(cLat, cLon);
            }
          }
        } catch (_) {}
      })();
    }
  }, [visible, initialTrigger, radiusKm, reverseLookup]);

  const handleRadiusUpdate = (nextRadius) => {
    setLocalRadiusKm(nextRadius);
    if (onRadiusChange) onRadiusChange(nextRadius);
    webViewRef.current?.injectJavaScript(
      `window.updatePinAndRadius && window.updatePinAndRadius(null, null, ${nextRadius}, false); true;`
    );
  };

  const handleWebViewMessage = (event) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload?.type === 'PIN_MOVED' && typeof payload.latitude === 'number' && typeof payload.longitude === 'number') {
        setLat(payload.latitude);
        setLon(payload.longitude);
        setStatusError(null);
        reverseLookup(payload.latitude, payload.longitude);
      }
    } catch (_) {}
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setStatusError(null);

    // Allow direct "lat, lon" coordinate search too
    const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const parsedLat = parseFloat(coordMatch[1]);
      const parsedLon = parseFloat(coordMatch[2]);
      if (Math.abs(parsedLat) <= 90 && Math.abs(parsedLon) <= 180) {
        setLat(parsedLat);
        setLon(parsedLon);
        setLabel(`Pin (${parsedLat.toFixed(4)}, ${parsedLon.toFixed(4)})`);
        webViewRef.current?.injectJavaScript(
          `window.updatePinAndRadius && window.updatePinAndRadius(${parsedLat}, ${parsedLon}, ${localRadiusKm}, true); true;`
        );
        setSearching(false);
        return;
      }
    }

    try {
      const fg = await Location.getForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        await Location.requestForegroundPermissionsAsync();
      }
      const matches = await Location.geocodeAsync(q);
      if (matches && matches.length > 0) {
        const hit = matches[0];
        setLat(hit.latitude);
        setLon(hit.longitude);
        setLabel(q);
        webViewRef.current?.injectJavaScript(
          `window.updatePinAndRadius && window.updatePinAndRadius(${hit.latitude}, ${hit.longitude}, ${localRadiusKm}, true); true;`
        );
      } else {
        setStatusError('Place not found. Tap directly on the map or enter "lat, lon".');
      }
    } catch (e) {
      setStatusError('Search unavailable offline. Tap on the map to pin.');
    } finally {
      setSearching(false);
    }
  };

  const handleUseMyGps = async () => {
    setLocating(true);
    setStatusError(null);
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status !== 'granted') {
        setStatusError('Location permission is required to use current GPS.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      });
      if (loc?.coords) {
        const cLat = loc.coords.latitude;
        const cLon = loc.coords.longitude;
        setLat(cLat);
        setLon(cLon);
        webViewRef.current?.injectJavaScript(
          `window.updatePinAndRadius && window.updatePinAndRadius(${cLat}, ${cLon}, ${localRadiusKm}, true); true;`
        );
        await reverseLookup(cLat, cLon);
      }
    } catch (_) {
      setStatusError('Could not acquire GPS fix. Tap the map to place a pin.');
    } finally {
      setLocating(false);
    }
  };

  const handleConfirm = () => {
    onConfirm({
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lon.toFixed(6)),
      label: label?.trim() || `Pin (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
      radiusKm: localRadiusKm,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <Text style={styles.closeText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pin Trigger Location</Text>
          <TouchableOpacity onPress={handleUseMyGps} style={styles.gpsBtn} disabled={locating} activeOpacity={0.7}>
            {locating ? (
              <ActivityIndicator size="small" color="#6366F1" />
            ) : (
              <Text style={styles.gpsBtnText}>📍 My GPS</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchBarRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search place, city, or lat, lon..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={searching} activeOpacity={0.8}>
            {searching ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.searchBtnText}>Find</Text>
            )}
          </TouchableOpacity>
        </View>

        {statusError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{statusError}</Text>
          </View>
        )}

        {/* Interactive Leaflet Map */}
        <View style={styles.mapContainer}>
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: buildLeafletHtml(lat, lon, localRadiusKm) }}
            onMessage={handleWebViewMessage}
            javaScriptEnabled
            domStorageEnabled
            style={styles.webview}
          />
          <View style={styles.mapHintPill} pointerEvents="none">
            <Text style={styles.mapHintText}>Tap anywhere or drag the violet pin</Text>
          </View>
        </View>

        {/* Bottom Sheet: Label + Radius + Confirm */}
        <View style={styles.bottomSheet}>
          <View style={styles.pinSummaryRow}>
            <View style={styles.pinDot} />
            <View style={{ flex: 1 }}>
              <TextInput
                style={styles.labelInput}
                value={label}
                onChangeText={setLabel}
                placeholder="Location label (e.g., Home, Office)"
                placeholderTextColor="#94A3B8"
              />
              <Text style={styles.coordSubtext}>
                {lat.toFixed(5)}, {lon.toFixed(5)} · Geofence {localRadiusKm.toFixed(1)} km
              </Text>
            </View>
          </View>

          <RadiusSlider value={localRadiusKm} onChange={handleRadiusUpdate} />

          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm} activeOpacity={0.85}>
            <Text style={styles.confirmBtnText}>Confirm Pinned Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F7FC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 16) + 8 : 48,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  closeText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  gpsBtn: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    minWidth: 78,
    alignItems: 'center',
  },
  gpsBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6366F1',
  },
  searchBarRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  searchBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  errorBanner: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
  },
  errorBannerText: {
    fontSize: 12,
    color: '#B45309',
    fontWeight: '600',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
  },
  mapHintPill: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  mapHintText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 30 : 18,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  pinSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  pinDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#6366F1',
  },
  labelInput: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    paddingVertical: 2,
  },
  coordSubtext: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  confirmBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
