const AdmZip = require('adm-zip');

/**
 * Парсер файлов KMZ и KML для страйкбольных карт полигона
 * Извлекает полигоны границ, линии и точки интереса в GeoJSON
 */
function parseKmlCoordinates(coordString) {
  if (!coordString) return [];
  const coords = [];
  const points = coordString.trim().split(/\s+/);
  for (const p of points) {
    const parts = p.split(',').map(n => parseFloat(n.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      // GeoJSON использует формат [долгота, широта] (lon, lat)
      coords.push([parts[0], parts[1]]);
    }
  }
  return coords;
}

function parseKmlText(kmlText) {
  const features = [];

  // Поиск всех Placemark блоков
  const placemarkRegex = /<Placemark[\s\S]*?<\/Placemark>/gi;
  const placemarks = kmlText.match(placemarkRegex) || [];

  // Если Placemark блоков нет, попробуем поискать координаты напрямую
  if (placemarks.length === 0) {
    const coordRegex = /<coordinates>([\s\S]*?)<\/coordinates>/gi;
    let match;
    while ((match = coordRegex.exec(kmlText)) !== null) {
      const coords = parseKmlCoordinates(match[1]);
      if (coords.length > 2) {
        if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
          coords.push([coords[0][0], coords[0][1]]);
        }
        features.push({
          type: 'Feature',
          properties: { name: 'Граница полигона', type: 'boundary' },
          geometry: {
            type: 'Polygon',
            coordinates: [coords]
          }
        });
      } else if (coords.length === 2) {
        features.push({
          type: 'Feature',
          properties: { name: 'Линия границы', type: 'line' },
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        });
      } else if (coords.length === 1) {
        features.push({
          type: 'Feature',
          properties: { name: 'Точка интереса', type: 'point' },
          geometry: {
            type: 'Point',
            coordinates: coords[0]
          }
        });
      }
    }
  }

  for (const pm of placemarks) {
    const nameMatch = pm.match(/<name>([\s\S]*?)<\/name>/i);
    const descMatch = pm.match(/<description>([\s\S]*?)<\/description>/i);
    const name = nameMatch ? nameMatch[1].trim() : 'Объект полигона';
    const description = descMatch ? descMatch[1].trim() : '';

    // Проверяем Polygon
    const polyCoordMatch = pm.match(/<Polygon[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Polygon>/i);
    if (polyCoordMatch) {
      const coords = parseKmlCoordinates(polyCoordMatch[1]);
      if (coords.length >= 3) {
        if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
          coords.push([coords[0][0], coords[0][1]]);
        }
        features.push({
          type: 'Feature',
          properties: { name, description, type: 'boundary' },
          geometry: {
            type: 'Polygon',
            coordinates: [coords]
          }
        });
        continue;
      }
    }

    // Проверяем LineString
    const lineCoordMatch = pm.match(/<LineString[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/i);
    if (lineCoordMatch) {
      const coords = parseKmlCoordinates(lineCoordMatch[1]);
      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { name, description, type: 'line' },
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        });
        continue;
      }
    }

    // Проверяем Point
    const pointCoordMatch = pm.match(/<Point[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/i);
    if (pointCoordMatch) {
      const coords = parseKmlCoordinates(pointCoordMatch[1]);
      if (coords.length >= 1) {
        features.push({
          type: 'Feature',
          properties: { name, description, type: 'point' },
          geometry: {
            type: 'Point',
            coordinates: coords[0]
          }
        });
      }
    }
  }

  // Расчет центра и границ полигона (bounds)
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  let totalPoints = 0;
  let sumLon = 0, sumLat = 0;

  function updateBounds(lon, lat) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    sumLon += lon;
    sumLat += lat;
    totalPoints++;
  }

  for (const f of features) {
    if (f.geometry.type === 'Point') {
      updateBounds(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    } else if (f.geometry.type === 'LineString') {
      f.geometry.coordinates.forEach(c => updateBounds(c[0], c[1]));
    } else if (f.geometry.type === 'Polygon') {
      f.geometry.coordinates[0].forEach(c => updateBounds(c[0], c[1]));
    }
  }

  const center = totalPoints > 0 ? [sumLat / totalPoints, sumLon / totalPoints] : [55.751244, 37.618423];
  const bounds = totalPoints > 0 ? [[minLat, minLon], [maxLat, maxLon]] : null;

  return {
    type: 'FeatureCollection',
    features,
    center, // [lat, lng]
    bounds  // [[minLat, minLon], [maxLat, maxLon]]
  };
}

function parseKmzBuffer(buffer) {
  // Проверяем ZIP сигнатуру (PK\x03\x04 = 0x50 0x4B 0x03 0x04)
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();
    let kmlEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.kml'));
    if (!kmlEntry && zipEntries.length > 0) {
      kmlEntry = zipEntries[0];
    }
    if (!kmlEntry) {
      throw new Error('Внутри KMZ архива не найден KML файл карты.');
    }
    const kmlText = kmlEntry.getData().toString('utf8');
    return parseKmlText(kmlText);
  } else {
    // Возможно передан чистый KML файл
    const text = buffer.toString('utf8');
    return parseKmlText(text);
  }
}

module.exports = {
  parseKmzBuffer,
  parseKmlText
};
