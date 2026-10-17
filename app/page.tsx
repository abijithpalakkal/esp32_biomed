"use client";

import { useEffect, useState, useCallback, useId } from "react";

interface BiomedRecord {
  id?: number | string;
  temperature: number;
  heart_rate?: number | null;
  spo2?: number | null;
  created_at: string;
}

interface ApiResponse {
  latest: BiomedRecord | null;
  history: BiomedRecord[];
  supabaseConnected: boolean;
  count: number;
  message?: string;
}

// ─── Classification Helpers ───────────────────────────────────────────────────

function classifyTemp(t: number) {
  if (t < 18) return { label: "Cold / Low", color: "#38bdf8", bg: "bg-sky-500/10", border: "border-sky-500/30" };
  if (t < 36) return { label: "Cool / Hypothermia Risk", color: "#38bdf8", bg: "bg-sky-500/10", border: "border-sky-500/30" };
  if (t <= 37.5) return { label: "Normal Body Temp", color: "#22c55e", bg: "bg-emerald-500/10", border: "border-emerald-500/30" };
  if (t <= 38.5) return { label: "Low-Grade Fever", color: "#facc15", bg: "bg-amber-500/10", border: "border-amber-500/30" };
  return { label: "High Fever", color: "#ef4444", bg: "bg-rose-500/10", border: "border-rose-500/30" };
}

function classifyHeartRate(hr?: number | null) {
  if (hr == null || hr <= 0) return { label: "No Pulse / Measuring", color: "#94a3b8", bg: "bg-slate-500/10", border: "border-slate-500/30" };
  if (hr < 50) return { label: "Bradycardia (Low)", color: "#38bdf8", bg: "bg-sky-500/10", border: "border-sky-500/30" };
  if (hr <= 100) return { label: "Normal Rhythm", color: "#22c55e", bg: "bg-emerald-500/10", border: "border-emerald-500/30" };
  if (hr <= 130) return { label: "Elevated Rate", color: "#facc15", bg: "bg-amber-500/10", border: "border-amber-500/30" };
  return { label: "Tachycardia (High)", color: "#ef4444", bg: "bg-rose-500/10", border: "border-rose-500/30" };
}

function classifySpO2(s?: number | null) {
  if (s == null || s <= 0) return { label: "Measuring...", color: "#94a3b8", bg: "bg-slate-500/10", border: "border-slate-500/30" };
  if (s >= 95) return { label: "Normal Saturation", color: "#22c55e", bg: "bg-emerald-500/10", border: "border-emerald-500/30" };
  if (s >= 90) return { label: "Mild Hypoxia", color: "#facc15", bg: "bg-amber-500/10", border: "border-amber-500/30" };
  return { label: "Critical Low SpO2", color: "#ef4444", bg: "bg-rose-500/10", border: "border-rose-500/30" };
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "--:--:--";
  }
}

function formatTimeShort(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function secondsAgo(iso?: string) {
  if (!iso) return 999;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

// ─── Radial Gauge ────────────────────────────────────────────────────────────

function RadialGauge({
  value,
  min = 10,
  max = 50,
  unit = "°C",
  color = "#22d3ee",
  label = "Temperature",
}: {
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  color?: string;
  label?: string;
}) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = (clamped - min) / (max - min);
  const startAngle = -220;
  const endAngle = 40;
  const sweep = (endAngle - startAngle) * pct;
  const r = 85;
  const cx = 110;
  const cy = 110;

  function polarToXY(angleDeg: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  const bgStart = polarToXY(startAngle);
  const bgEnd = polarToXY(endAngle);
  const bgPath = `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 1 1 ${bgEnd.x} ${bgEnd.y}`;

  const valEnd = polarToXY(startAngle + Math.max(0.01, sweep));
  const valSweepFlag = sweep > 180 ? 1 : 0;
  const valPath = `M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 ${valSweepFlag} 1 ${valEnd.x} ${valEnd.y}`;

  return (
    <div className="relative flex flex-col items-center">
      <svg viewBox="0 0 220 180" className="w-52 h-44 drop-shadow-[0_0_20px_rgba(34,197,94,0.12)]">
        <defs>
          <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="70%" stopColor={color} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <filter id="gaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <path
          d={bgPath}
          fill="none"
          stroke="#1e293b"
          strokeWidth="12"
          strokeLinecap="round"
        />

        {/* Dynamic value arc */}
        <path
          d={valPath}
          fill="none"
          stroke="url(#gaugeGradient)"
          strokeWidth="12"
          strokeLinecap="round"
          filter="url(#gaugeGlow)"
          className="transition-all duration-700 ease-out"
        />

        {/* Center reading */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill="#f8fafc"
          fontSize="38"
          fontWeight="700"
          className="font-mono tracking-tight"
        >
          {value.toFixed(1)}
        </text>
        <text
          x={cx}
          y={cy + 22}
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="13"
          fontWeight="500"
        >
          {unit}
        </text>
      </svg>
      <span className="text-[11px] font-medium text-slate-400 -mt-2 uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ─── SVG Interactive Line Graph ──────────────────────────────────────────────

interface GraphProps {
  data: BiomedRecord[];
  metricKey: "temperature" | "heart_rate" | "spo2";
  lineColor: string;
  glowColor: string;
  unit: string;
  title: string;
  defaultMin: number;
  defaultMax: number;
}

function UniversalGraph({
  data,
  metricKey,
  lineColor,
  glowColor,
  unit,
  title,
  defaultMin,
  defaultMax,
}: GraphProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const gradId = useId();

  // Filter out records without valid data for this specific metric
  const validData = data.filter((d) => d[metricKey] != null && !isNaN(Number(d[metricKey])));

  if (validData.length === 0) {
    return (
      <div className="h-60 flex flex-col items-center justify-center text-slate-500 text-sm">
        <svg className="w-8 h-8 mb-2 opacity-40 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
        No readings recorded for {title} yet.
      </div>
    );
  }

  const width = 640;
  const height = 240;
  const padLeft = 46;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 34;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const values = validData.map((d) => Number(d[metricKey]));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const minVal = Math.floor(Math.min(rawMin, defaultMin));
  const maxVal = Math.ceil(Math.max(rawMax, defaultMax));
  const range = Math.max(2, maxVal - minVal);

  const points = validData.map((d, i) => {
    const val = Number(d[metricKey]);
    const x = padLeft + (validData.length === 1 ? chartW / 2 : (i / (validData.length - 1)) * chartW);
    const y = padTop + chartH - ((val - minVal) / range) * chartH;
    return { x, y, val, time: d.created_at, idx: i };
  });

  const linePath = points.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), "");
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${padTop + chartH} L ${points[0].x} ${padTop + chartH} Z`
    : "";

  const gridSteps = 4;
  const yTicks = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const val = minVal + (range / gridSteps) * i;
    const y = padTop + chartH - (i / gridSteps) * chartH;
    return { val: metricKey === "temperature" ? val.toFixed(1) : Math.round(val), y };
  });

  const activePoint = hoveredIdx !== null && points[hoveredIdx] ? points[hoveredIdx] : points[points.length - 1];

  return (
    <div className="relative w-full">
      <div className="flex items-center justify-between mb-3 px-1 text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 font-medium" style={{ color: lineColor }}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lineColor }}></span>
            {title} Trend
          </span>
          {activePoint && (
            <span className="text-slate-300 font-mono">
              Hovered:{" "}
              <strong style={{ color: lineColor }} className="font-semibold">
                {metricKey === "temperature" ? activePoint.val.toFixed(2) : Math.round(activePoint.val)}
                {unit}
              </strong>{" "}
              @ {formatTime(activePoint.time)}
            </span>
          )}
        </div>
        <span>{validData.length} records</span>
      </div>

      <div className="relative w-full overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/60 p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto cursor-crosshair select-none"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <defs>
            <linearGradient id={`grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={glowColor} stopOpacity="0.4" />
              <stop offset="80%" stopColor={glowColor} stopOpacity="0.05" />
              <stop offset="100%" stopColor={glowColor} stopOpacity="0.0" />
            </linearGradient>
            <filter id={`glow-${gradId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Grid lines */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padLeft}
                y1={tick.y}
                x2={width - padRight}
                y2={tick.y}
                stroke="#1e293b"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <text
                x={padLeft - 8}
                y={tick.y + 4}
                textAnchor="end"
                fill="#64748b"
                fontSize="10"
                fontFamily="monospace"
              >
                {tick.val}
              </text>
            </g>
          ))}

          {/* Area */}
          <path d={areaPath} fill={`url(#grad-${gradId})`} />

          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={lineColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#glow-${gradId})`}
          />

          {/* X axis ticks */}
          {points.length > 1 &&
            [0, Math.floor(points.length / 2), points.length - 1].map((idx) => {
              const p = points[idx];
              return (
                <text
                  key={idx}
                  x={p.x}
                  y={height - 10}
                  textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {formatTimeShort(p.time)}
                </text>
              );
            })}

          {/* Hover hit areas and points */}
          {points.map((p, i) => (
            <g key={i} onMouseEnter={() => setHoveredIdx(i)}>
              <rect
                x={p.x - 12}
                y={padTop}
                width="24"
                height={chartH}
                fill="transparent"
                className="cursor-pointer"
              />
              {(hoveredIdx === i || (hoveredIdx === null && i === points.length - 1)) && (
                <>
                  <line
                    x1={p.x}
                    y1={padTop}
                    x2={p.x}
                    y2={padTop + chartH}
                    stroke={lineColor}
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                    opacity="0.8"
                  />
                  <circle cx={p.x} cy={p.y} r="6" fill={lineColor} opacity="0.4" />
                  <circle cx={p.x} cy={p.y} r="4" fill={lineColor} stroke="#ffffff" strokeWidth="1.5" />
                </>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ─── Pulse Dot Component ─────────────────────────────────────────────────────

function PulseDot({ alive }: { alive: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {alive && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
          alive ? "bg-emerald-500" : "bg-slate-600"
        }`}
      />
    </span>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Home() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [testSending, setTestSending] = useState(false);
  const [showSqlGuide, setShowSqlGuide] = useState(false);
  const [ago, setAgo] = useState(0);
  const [activeTab, setActiveTab] = useState<"all" | "temperature" | "heart_rate" | "spo2">("all");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/temperature?limit=40", { cache: "no-store" });
      const json: ApiResponse = await res.json();
      setData(json);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching data:", err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (data?.latest) {
        setAgo(secondsAgo(data.latest.created_at));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [data]);

  // Quick test sender to insert a realistic sample reading
  const handleSendTestReading = async () => {
    setTestSending(true);
    try {
      const randomTemp = Number((36.2 + Math.random() * 1.5).toFixed(2));
      const randomHr = Math.floor(68 + Math.random() * 18);
      const randomSpo2 = Math.floor(96 + Math.random() * 4);

      await fetch("/api/temperature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          temperature: randomTemp,
          heartRate: randomHr,
          spo2: randomSpo2,
        }),
      });
      await fetchData();
    } catch (err) {
      console.error("Test send failed:", err);
    } finally {
      setTestSending(false);
    }
  };

  const latest = data?.latest;
  const history = data?.history || [];
  const isAlive = latest ? secondsAgo(latest.created_at) < 20 : false;

  const tempStatus = latest ? classifyTemp(latest.temperature) : null;
  const hrStatus = latest ? classifyHeartRate(latest.heart_rate) : null;
  const spo2Status = latest ? classifySpO2(latest.spo2) : null;

  const hasFinger = latest?.spo2 != null && latest.spo2 > 0 && latest?.heart_rate != null && latest.heart_rate > 0;

  // Stats calculation
  const temps = history.map((h) => h.temperature);
  const avgTemp = temps.length > 0 ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : "--";

  const hrs = history.filter((h) => h.heart_rate != null && h.heart_rate > 0).map((h) => h.heart_rate as number);
  const avgHr = hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : "--";

  const spo2s = history.filter((h) => h.spo2 != null && h.spo2 > 0).map((h) => h.spo2 as number);
  const avgSpo2 = spo2s.length > 0 ? Math.round(spo2s.reduce((a, b) => a + b, 0) / spo2s.length) : "--";

  return (
    <main className="min-h-screen w-full flex flex-col items-center px-4 py-8 max-w-7xl mx-auto space-y-8 text-slate-100">
      {/* ─── Top Header ──────────────────────────────────────────────────────── */}
      <header className="w-full flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-rose-500/20 border border-cyan-500/30 text-cyan-400 shadow-[0_0_25px_rgba(6,182,212,0.2)]">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                ESP32 BioMed Telemetry
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Live Vitals
              </span>
            </div>
            <p className="text-slate-400 text-xs sm:text-sm">
              DS18B20 Temp • MAX30105 SpO2 & Heart Rate • Supabase Cloud Logging
            </p>
          </div>
        </div>

        {/* Status badges & controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Supabase status badge */}
          <div
            onClick={() => setShowSqlGuide(!showSqlGuide)}
            className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              data?.supabaseConnected
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20"
            }`}
            title="Click for Supabase config details & SQL schema"
          >
            <span className={`w-2 h-2 rounded-full ${data?.supabaseConnected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
            <span>{data?.supabaseConnected ? "Supabase Connected" : "Supabase: Configure .env.local"}</span>
            <span className="text-[10px] opacity-75 underline ml-1">Schema</span>
          </div>

          {/* Finger Sensor Status */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
              hasFinger
                ? "bg-rose-500/10 text-rose-300 border-rose-500/30"
                : "bg-slate-800 text-slate-400 border-slate-700"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${hasFinger ? "bg-rose-400 animate-pulse" : "bg-slate-500"}`} />
            <span>{hasFinger ? "Finger Detected" : "No Finger on MAX30105"}</span>
          </div>

          {/* Live ESP32 Status */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
              isAlive
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-slate-800 text-slate-400 border-slate-700"
            }`}
          >
            <PulseDot alive={isAlive} />
            <span>{isAlive ? "ESP32 Live" : "ESP32 Offline / Waiting"}</span>
          </div>

          {/* Test push button */}
          <button
            onClick={handleSendTestReading}
            disabled={testSending}
            className="px-3 py-1.5 rounded-full text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
          >
            {testSending ? "Sending..." : "Simulate Reading"}
          </button>
        </div>
      </header>

      {/* ─── Supabase SQL Guide / Migration Banner ──────────────────────────── */}
      {(!data?.supabaseConnected || showSqlGuide) && (
        <section className="w-full rounded-2xl border border-cyan-500/30 bg-slate-900/90 p-5 text-slate-300 text-sm space-y-3 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-cyan-400 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7M4 7c0-2 1.5-3 3.5-3h9c2 0 3.5 1 3.5 3M4 7h16m-8 4v6m-3-3h6" />
              </svg>
              Supabase SQL Query — Add SpO2 & Heart Rate Columns
            </h2>
            <button
              onClick={() => setShowSqlGuide(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              ✕ Close
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-300">
            Run this quick query in your Supabase Dashboard (<span className="text-white font-medium">SQL Editor → New Query</span>) to add the new SpO2 and Heart Rate columns to your existing table:
          </p>
          <pre className="bg-slate-950 text-emerald-400 p-3 rounded-lg text-xs font-mono overflow-x-auto border border-slate-800 select-all">
{`-- Upgrade existing temperature_readings table:
ALTER TABLE public.temperature_readings 
  ADD COLUMN IF NOT EXISTS heart_rate INTEGER,
  ADD COLUMN IF NOT EXISTS spo2 INTEGER;`}
          </pre>
          <p className="text-[11px] text-slate-400">
            For fresh project setups, full schema with Row Level Security is saved in <code className="text-cyan-300 bg-cyan-950/60 px-1 py-0.5 rounded">supabase_schema.sql</code>.
          </p>
        </section>
      )}

      {/* ─── 3 Primary Vitals Cards Grid ────────────────────────────────────── */}
      <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Body Temperature */}
        <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-5 shadow-2xl backdrop-blur-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </span>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Temperature</h3>
                <span className="text-[10px] text-slate-500">DS18B20 GPIO 4</span>
              </div>
            </div>
            {tempStatus && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${tempStatus.bg} ${tempStatus.border}`}
                style={{ color: tempStatus.color }}
              >
                {tempStatus.label}
              </span>
            )}
          </div>

          <div className="my-2 flex justify-center">
            {latest ? (
              <RadialGauge
                value={latest.temperature}
                min={20}
                max={45}
                unit="°C"
                color={tempStatus?.color || "#22d3ee"}
                label="Body Temp"
              />
            ) : (
              <div className="h-44 flex flex-col items-center justify-center text-slate-500 text-xs">
                <div className="w-8 h-8 border-2 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin mb-2"></div>
                Waiting for temp...
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-800/60 text-xs">
            <span className="text-slate-400">Average Temp</span>
            <span className="font-mono font-semibold text-cyan-400">{avgTemp}°C</span>
          </div>
        </section>

        {/* Card 2: Heart Rate (BPM) */}
        <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-5 shadow-2xl backdrop-blur-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                <svg className={`w-5 h-5 ${latest?.heart_rate ? "animate-pulse" : ""}`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </span>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Heart Rate</h3>
                <span className="text-[10px] text-slate-500">MAX30105 Optical</span>
              </div>
            </div>
            {hrStatus && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${hrStatus.bg} ${hrStatus.border}`}
                style={{ color: hrStatus.color }}
              >
                {hrStatus.label}
              </span>
            )}
          </div>

          <div className="my-2 flex flex-col items-center justify-center h-44">
            <div className="text-center">
              <div className="flex items-baseline justify-center gap-1.5">
                <span className="text-5xl font-black font-mono tracking-tight text-white drop-shadow-[0_0_15px_rgba(244,63,94,0.3)]">
                  {latest?.heart_rate && latest.heart_rate > 0 ? latest.heart_rate : "--"}
                </span>
                <span className="text-rose-400 font-semibold text-sm">BPM</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Beats Per Minute</p>
            </div>

            {/* Animated EKG Wave representation */}
            <div className="w-full h-10 mt-3 px-4 flex items-center justify-center">
              <svg className="w-full h-8 stroke-rose-500" viewBox="0 0 160 30" fill="none">
                <path
                  d="M0 15 L35 15 L45 5 L55 25 L65 5 L75 20 L82 15 L160 15"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={latest?.heart_rate ? "animate-pulse" : "opacity-30"}
                />
              </svg>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-800/60 text-xs">
            <span className="text-slate-400">Avg Heart Rate</span>
            <span className="font-mono font-semibold text-rose-400">{avgHr} BPM</span>
          </div>
        </section>

        {/* Card 3: Blood Oxygen (SpO2) */}
        <section className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-5 shadow-2xl backdrop-blur-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </span>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Blood Oxygen</h3>
                <span className="text-[10px] text-slate-500">SpO2 Saturation</span>
              </div>
            </div>
            {spo2Status && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${spo2Status.bg} ${spo2Status.border}`}
                style={{ color: spo2Status.color }}
              >
                {spo2Status.label}
              </span>
            )}
          </div>

          <div className="my-2 flex flex-col items-center justify-center h-44">
            <div className="relative flex items-center justify-center">
              {/* Circular saturation ring */}
              <svg className="w-36 h-36 -rotate-90">
                <circle
                  cx="72"
                  cy="72"
                  r="56"
                  stroke="#1e293b"
                  strokeWidth="10"
                  fill="transparent"
                />
                <circle
                  cx="72"
                  cy="72"
                  r="56"
                  stroke={spo2Status?.color || "#10b981"}
                  strokeWidth="10"
                  strokeDasharray={351.8}
                  strokeDashoffset={
                    latest?.spo2 && latest.spo2 > 0
                      ? 351.8 - (351.8 * Math.min(100, Math.max(0, latest.spo2))) / 100
                      : 351.8
                  }
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-4xl font-extrabold font-mono text-white">
                  {latest?.spo2 && latest.spo2 > 0 ? latest.spo2 : "--"}
                  <span className="text-lg text-emerald-400 ml-0.5">%</span>
                </span>
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Oxygen Sat.</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-800/60 text-xs">
            <span className="text-slate-400">Avg SpO2</span>
            <span className="font-mono font-semibold text-emerald-400">{avgSpo2}%</span>
          </div>
        </section>
      </div>

      {/* ─── Historical Trend Graphs Section ────────────────────────────────── */}
      <section className="w-full rounded-3xl border border-white/5 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-6 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
              Historical Vitals Trends
            </h2>
            <p className="text-xs text-slate-400">
              Interactive biometric graphs populated continuously from ESP32 & Supabase
            </p>
          </div>

          {/* Metric Selector Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "all" ? "bg-slate-800 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              All Overview
            </button>
            <button
              onClick={() => setActiveTab("temperature")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "temperature" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-slate-400 hover:text-white"
              }`}
            >
              Temperature
            </button>
            <button
              onClick={() => setActiveTab("heart_rate")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "heart_rate" ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" : "text-slate-400 hover:text-white"
              }`}
            >
              Heart Rate (BPM)
            </button>
            <button
              onClick={() => setActiveTab("spo2")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "spo2" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "text-slate-400 hover:text-white"
              }`}
            >
              SpO2 (%)
            </button>
          </div>
        </div>

        {/* Tab Content Display */}
        {activeTab === "all" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <UniversalGraph
              data={history}
              metricKey="temperature"
              lineColor="#22d3ee"
              glowColor="#06b6d4"
              unit="°C"
              title="Body Temperature"
              defaultMin={25}
              defaultMax={40}
            />
            <UniversalGraph
              data={history}
              metricKey="heart_rate"
              lineColor="#fb7185"
              glowColor="#f43f5e"
              unit=" BPM"
              title="Heart Rate"
              defaultMin={50}
              defaultMax={120}
            />
            <UniversalGraph
              data={history}
              metricKey="spo2"
              lineColor="#34d399"
              glowColor="#10b981"
              unit="%"
              title="Blood Oxygen (SpO2)"
              defaultMin={88}
              defaultMax={100}
            />
          </div>
        )}

        {activeTab === "temperature" && (
          <UniversalGraph
            data={history}
            metricKey="temperature"
            lineColor="#22d3ee"
            glowColor="#06b6d4"
            unit="°C"
            title="Body Temperature"
            defaultMin={20}
            defaultMax={45}
          />
        )}

        {activeTab === "heart_rate" && (
          <UniversalGraph
            data={history}
            metricKey="heart_rate"
            lineColor="#fb7185"
            glowColor="#f43f5e"
            unit=" BPM"
            title="Heart Rate (BPM)"
            defaultMin={40}
            defaultMax={140}
          />
        )}

        {activeTab === "spo2" && (
          <UniversalGraph
            data={history}
            metricKey="spo2"
            lineColor="#34d399"
            glowColor="#10b981"
            unit="%"
            title="Blood Oxygen (SpO2 %)"
            defaultMin={85}
            defaultMax={100}
          />
        )}
      </section>

      {/* ─── Recent Telemetry Log Table ─────────────────────────────────────── */}
      <section className="w-full rounded-3xl border border-white/5 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-6 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Recent Telemetry Feed</h2>
            <p className="text-xs text-slate-400">Chronological telemetry entries from ESP32</p>
          </div>
          <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-full">
            {history.length} records in cache
          </span>
        </div>

        <div className="w-full overflow-x-auto rounded-xl border border-slate-800/80">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-4">Temperature</th>
                <th className="py-3 px-4">Heart Rate (BPM)</th>
                <th className="py-3 px-4">SpO2 Oxygen</th>
                <th className="py-3 px-4">Status Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500 font-sans">
                    No records available yet. Turn on your ESP32 or click "Simulate Reading".
                  </td>
                </tr>
              ) : (
                [...history].reverse().slice(0, 15).map((row, idx) => {
                  const tStatus = classifyTemp(row.temperature);
                  const hStatus = classifyHeartRate(row.heart_rate);
                  const sStatus = classifySpO2(row.spo2);
                  return (
                    <tr key={row.id ?? idx} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 text-slate-300">{formatTime(row.created_at)}</td>
                      <td className="py-3 px-4 text-cyan-300 font-semibold">{row.temperature.toFixed(2)}°C</td>
                      <td className="py-3 px-4">
                        {row.heart_rate != null && row.heart_rate > 0 ? (
                          <span className="text-rose-400 font-semibold">{row.heart_rate} BPM</span>
                        ) : (
                          <span className="text-slate-500">--</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {row.spo2 != null && row.spo2 > 0 ? (
                          <span className="text-emerald-400 font-semibold">{row.spo2}%</span>
                        ) : (
                          <span className="text-slate-500">--</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-sans">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${tStatus.bg}`} style={{ color: tStatus.color }}>
                            {tStatus.label}
                          </span>
                          {row.heart_rate != null && row.heart_rate > 0 && (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${hStatus.bg}`} style={{ color: hStatus.color }}>
                              {hStatus.label}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="w-full rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
          <span>
            ESP32 Destination:{" "}
            <code className="text-cyan-300 font-mono">POST http://192.168.29.176:3000/api/temperature</code>
          </span>
        </div>
        <span className="text-slate-500">
          Auto-refreshing stream active (3s intervals)
        </span>
      </footer>
    </main>
  );
}
