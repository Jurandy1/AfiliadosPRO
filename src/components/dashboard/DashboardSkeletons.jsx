import React from "react";

export function SkeletonFinanceiro() {
  return (
    <div className="rounded-2xl p-5 bg-slate-100 border border-slate-200/60 shadow-sm animate-pulse">
      <div className="h-5 w-48 bg-slate-200 rounded mb-4" />
      <div className="rounded-xl p-4 bg-white/50 border border-slate-200/50 mb-4 space-y-3">
        <div className="h-3 w-20 bg-slate-200 rounded" />
        <div className="h-4 w-32 bg-slate-200 rounded" />
        <div className="h-7 w-40 bg-slate-200 rounded" />
        <div className="flex gap-3 pt-1">
          <div className="h-3 w-24 bg-slate-200 rounded" />
          <div className="h-3 w-20 bg-slate-200 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-200/60">
        <div className="flex gap-3 items-center">
          <div className="w-9 h-9 rounded-full bg-slate-200 shrink-0" />
          <div className="space-y-1.5 w-full">
            <div className="h-3 w-16 bg-slate-200 rounded" />
            <div className="h-4 w-20 bg-slate-200 rounded" />
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <div className="w-9 h-9 rounded-full bg-slate-200 shrink-0" />
          <div className="space-y-1.5 w-full">
            <div className="h-3 w-20 bg-slate-200 rounded" />
            <div className="h-4 w-24 bg-slate-200 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonVolume() {
  return (
    <div className="rounded-2xl p-5 bg-slate-100 border border-slate-200/60 shadow-sm animate-pulse">
      <div className="h-5 w-40 bg-slate-200 rounded mb-4" />
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3 items-center">
            <div className="w-9 h-9 rounded-full bg-slate-200 shrink-0" />
            <div className="space-y-1.5 w-full">
              <div className="h-3 w-20 bg-slate-200 rounded" />
              <div className="h-4 w-24 bg-slate-200 rounded" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-200/60 flex gap-4">
        <div className="h-3 w-20 bg-slate-200 rounded" />
        <div className="h-3 w-20 bg-slate-200 rounded" />
      </div>
    </div>
  );
}

export function SkeletonPedidosCards() {
  return (
    <div className="space-y-3">
      <div className="h-4 w-44 bg-slate-200 rounded animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-2xl p-5 bg-white border border-slate-200 shadow-sm flex gap-4 items-start animate-pulse">
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-28 bg-slate-200 rounded" />
              <div className="h-7 w-16 bg-slate-200 rounded" />
              <div className="h-3 w-32 bg-slate-200 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-5 w-40 bg-slate-200 rounded" />
        <div className="flex gap-2">
          <div className="h-8 w-16 bg-slate-100 rounded-lg" />
          <div className="h-8 w-16 bg-slate-100 rounded-lg" />
        </div>
      </div>
      <div className="h-64 bg-slate-50 border border-dashed border-slate-200 rounded-xl flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 animate-shimmer animate-pulse" />
        <div className="w-full h-full opacity-20 flex items-end justify-between px-6 pb-4 pt-10">
          {[40, 60, 45, 75, 50, 90, 65, 80, 55, 70, 85, 60].map((h, i) => (
            <div key={i} className="w-4 bg-slate-300 rounded-t" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
