import { addReminder, listReminders, addNote, queryNotes } from '../db.js';

/**
 * Maps Open-Meteo WMO Weather Codes to human-readable descriptions
 */
function interpretWeatherCode(code) {
  const mapping = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snowfall',
    73: 'Moderate snowfall',
    75: 'Heavy snowfall',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail'
  };
  return mapping[code] || 'Fair';
}

/**
 * Fetch real-time weather using Open-Meteo (Free, No API Key required)
 */
async function fetchWeather(location) {
  const loc = location || 'New York';
  try {
    // 1. Geocode location name to latitude & longitude
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=en&format=json`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
      return {
        error: `Could not find location coordinates for "${loc}".`,
        location: loc
      };
    }

    const { latitude, longitude, name, country, admin1 } = geoData.results[0];
    const resolvedName = [name, admin1, country].filter(Boolean).join(', ');

    // 2. Fetch current weather conditions
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=celsius&wind_speed_unit=kmh`;
    const weatherRes = await fetch(weatherUrl);
    const weatherData = await weatherRes.json();

    if (!weatherData.current) {
      return {
        error: `Unable to retrieve weather data for "${loc}".`,
        location: resolvedName
      };
    }

    const temp = Math.round(weatherData.current.temperature_2m);
    const code = weatherData.current.weather_code;
    const condition = interpretWeatherCode(code);
    const humidity = weatherData.current.relative_humidity_2m;
    const windSpeed = Math.round(weatherData.current.wind_speed_10m);

    return {
      location: resolvedName,
      temperature: `${temp}°C`,
      condition,
      humidity: `${humidity}%`,
      windSpeed: `${windSpeed} km/h`
    };
  } catch (err) {
    console.error(`[Weather API Error]`, err.message);
    return {
      error: `Network error retrieving weather: ${err.message}`,
      location: loc
    };
  }
}

/**
 * Tool Execution Dispatcher
 */
export async function executeTool(name, args = {}) {
  console.log(`[Tool Execute] ${name} with args:`, JSON.stringify(args));

  switch (name) {
    case 'set_reminder': {
      const text = args.text || 'Reminder';
      const when = args.when || null;
      const reminder = addReminder(text, when);
      return {
        status: 'success',
        message: `Reminder created: "${text}"${when ? ` scheduled for ${when}` : ''}.`,
        reminder
      };
    }

    case 'list_reminders': {
      const reminders = listReminders();
      return {
        status: 'success',
        count: reminders.length,
        reminders: reminders.slice(0, 10)
      };
    }

    case 'get_weather': {
      const location = args.location || 'here';
      const weather = await fetchWeather(location);
      return {
        status: weather.error ? 'error' : 'success',
        ...weather
      };
    }

    case 'add_note': {
      const text = args.text || '';
      if (!text.trim()) {
        return { status: 'error', message: 'Note text cannot be empty.' };
      }
      const note = addNote(text.trim());
      return {
        status: 'success',
        message: `Note saved: "${text}"`,
        note
      };
    }

    case 'query_notes': {
      const query = args.query || '';
      const notes = queryNotes(query);
      return {
        status: 'success',
        count: notes.length,
        notes
      };
    }

    default:
      return {
        status: 'error',
        message: `Unknown tool "${name}".`
      };
  }
}

/**
 * Tool definitions conforming to Gemini & Anthropic formats
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'set_reminder',
    description: 'Create a reminder for the user.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'What to remind the user about (e.g. "call mom", "buy groceries")'
        },
        when: {
          type: 'string',
          description: 'When to remind the user (ISO 8601 datetime, e.g. "2026-09-04T17:00:00Z" or conversational time)'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'list_reminders',
    description: 'List the active saved reminders for the user.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_weather',
    description: 'Get the current live weather and temperature for a given city or location.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city or location name (e.g. "Pune", "London", "Tokyo", "San Francisco")'
        }
      },
      required: ['location']
    }
  },
  {
    name: 'add_note',
    description: 'Save a quick personal note or thought to the user notebook database.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The content of the note to save'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'query_notes',
    description: 'Search through previously saved notes by keyword.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword or query to find in notes'
        }
      },
      required: ['query']
    }
  }
];
