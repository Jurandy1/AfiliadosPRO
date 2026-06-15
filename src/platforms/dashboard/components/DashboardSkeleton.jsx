import React from "react";
import { Skeleton } from "../../../components/ui/Skeleton";

export default function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Top Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex flex-col justify-between h-28">
            <div className="flex justify-between items-start">
              <Skeleton className="h-4 w-1/2 bg-gray-200" />
              <Skeleton className="h-8 w-8 rounded-full bg-gray-100" />
            </div>
            <div className="space-y-2 mt-4">
              <Skeleton className="h-6 w-3/4 bg-gray-200" />
              <Skeleton className="h-3 w-1/3 bg-gray-100" />
            </div>
          </div>
        ))}
      </div>

      {/* Main Chart Area */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm h-80 flex flex-col">
        <Skeleton className="h-5 w-1/4 mb-6 bg-gray-200" />
        <div className="flex-1 flex items-end justify-between space-x-2">
          {[...Array(12)].map((_, i) => (
            <Skeleton
              key={i}
              className="w-full bg-gray-100 rounded-t-sm"
              style={{ height: `${Math.max(20, Math.random() * 100)}%` }}
            />
          ))}
        </div>
      </div>

      {/* Tables/Breakdown Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Table (Bigger) */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-gray-100 shadow-sm h-96 flex flex-col">
          <Skeleton className="h-5 w-1/3 mb-6 bg-gray-200" />
          <div className="space-y-4 flex-1">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full bg-gray-100 rounded" />
            ))}
          </div>
        </div>

        {/* Right Table (Smaller) */}
        <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm h-96 flex flex-col">
          <Skeleton className="h-5 w-1/2 mb-6 bg-gray-200" />
          <div className="space-y-4 flex-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="flex items-center space-x-3 w-1/2">
                  <Skeleton className="h-8 w-8 rounded bg-gray-100" />
                  <Skeleton className="h-4 w-full bg-gray-100" />
                </div>
                <Skeleton className="h-4 w-1/4 bg-gray-100" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
