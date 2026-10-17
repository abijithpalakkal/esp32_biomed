import {
  isDbConfigured,
  insertTemperatureReading,
  getTemperatureReadings,
  DbTempRecord,
} from "@/lib/db";

export type TempRecord = DbTempRecord;

// In-memory fallback cache so the app keeps working even before database is configured
let memoryHistory: TempRecord[] = [];
let memoryLatest: TempRecord | null = null;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const temp = parseFloat(body.temperature);

    if (isNaN(temp)) {
      return Response.json(
        { error: "Invalid temperature value" },
        { status: 400 }
      );
    }

    // Parse heart rate and SpO2 (supporting camelCase, snake_case, and aliases)
    const rawHr = body.heartRate ?? body.heart_rate ?? body.bpm;
    const rawSpo2 = body.spo2 ?? body.spO2;

    const heartRate =
      rawHr !== undefined && rawHr !== null && !isNaN(Number(rawHr))
        ? Math.round(Number(rawHr))
        : null;

    const spo2 =
      rawSpo2 !== undefined && rawSpo2 !== null && !isNaN(Number(rawSpo2))
        ? Math.round(Number(rawSpo2))
        : null;

    const timestamp = new Date().toISOString();
    let savedToDatabase = false;
    let finalRecord: TempRecord = {
      temperature: temp,
      heart_rate: heartRate,
      spo2: spo2,
      created_at: timestamp,
    };

    if (isDbConfigured) {
      const dbRecord = await insertTemperatureReading(
        temp,
        timestamp,
        heartRate,
        spo2
      );
      if (dbRecord) {
        savedToDatabase = true;
        finalRecord = dbRecord;
      }
    }

    // Always update in-memory cache for instant responsiveness
    memoryLatest = finalRecord;
    memoryHistory.unshift(finalRecord);
    if (memoryHistory.length > 50) {
      memoryHistory.pop();
    }

    console.log(
      `[API] Received vitals -> Temp: ${temp}°C | HR: ${heartRate ?? "--"} BPM | SpO2: ${spo2 ?? "--"}% (DB: ${savedToDatabase})`
    );

    return Response.json(
      {
        success: true,
        data: finalRecord,
        savedToSupabase: savedToDatabase,
        supabaseConnected: isDbConfigured,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid JSON body";
    return Response.json(
      { error: message },
      { status: 400 }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "30", 10), 100);

  if (isDbConfigured) {
    try {
      const records = await getTemperatureReadings(limit);

      if (records && records.length > 0) {
        return Response.json({
          latest: records[0],
          history: [...records].reverse(), // chronologically ordered (oldest to newest) for graphing
          supabaseConnected: true,
          count: records.length,
        });
      }
    } catch (dbErr) {
      console.warn("[API] DB fetch error, using cache fallback:", dbErr);
    }
  }

  // Fallback to in-memory store
  const cachedHistory = [...memoryHistory].slice(0, limit).reverse();
  return Response.json({
    latest: memoryLatest,
    history: cachedHistory,
    supabaseConnected: isDbConfigured,
    count: cachedHistory.length,
    message: isDbConfigured
      ? "Database connected but no records found yet"
      : "Database not configured in .env.local — using in-memory mode",
  });
}
