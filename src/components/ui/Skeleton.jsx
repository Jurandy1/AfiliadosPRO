import React from "react";

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={`relative overflow-hidden bg-gray-100 rounded-md ${className}`}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}
