import { useEffect, useMemo, useRef, useState } from "react";

function chartPayloadSignature(type, data, options) {
  if (!data) return "";
  try {
    return JSON.stringify({
      type,
      labels: data.labels,
      datasets: (data.datasets || []).map((d) => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.backgroundColor,
        borderColor: d.borderColor,
        borderDash: d.borderDash,
      })),
      indexAxis: options?.indexAxis,
      cutout: options?.cutout,
    });
  } catch {
    return "";
  }
}

let chartModulePromise = null;

function loadChartModule() {
  if (!chartModulePromise) {
    chartModulePromise = import("chart.js").then(({ Chart, registerables }) => {
      Chart.register(...registerables);
      return Chart;
    });
  }
  return chartModulePromise;
}

export default function ChartCanvas({ type, data, options, height = 260 }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const [ChartCtor, setChartCtor] = useState(null);

  const payloadSig = useMemo(
    () => chartPayloadSignature(type, data, options),
    [type, data, options],
  );

  useEffect(() => {
    let alive = true;
    loadChartModule()
      .then((Chart) => { if (alive) setChartCtor(() => Chart); })
      .catch((err) => console.warn("[ChartCanvas] Falha ao carregar chart.js:", err));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ChartCtor || !ref.current || !data) return;

    const opts = {
      ...options,
      animation: false,
      animations: {
        x: { duration: 0 },
        y: { duration: 0 },
      },
      transitions: {
        active: { animation: { duration: 0 } },
        resize: { animation: { duration: 0 } },
      },
    };

    chartRef.current?.destroy();
    chartRef.current = null;

    chartRef.current = new ChartCtor(ref.current, { type, data, options: opts });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [ChartCtor, payloadSig, type]);

  return (
    <div style={{ position: "relative", height }}>
      {!ChartCtor && (
        <div
          className="absolute inset-0 rounded-lg bg-slate-100/80 animate-pulse"
          aria-hidden
        />
      )}
      <canvas ref={ref} />
    </div>
  );
}
