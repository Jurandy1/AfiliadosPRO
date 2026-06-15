import { ArrowUpDown } from "lucide-react";

export default function SortTh({ label, field, sortField, onSort, className = "" }) {
  const active = sortField === field;
  return (
    <th
      className={`px-2 py-2 cursor-pointer select-none hover:text-gray-700 ${className}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-0.5 justify-center w-full">
        {label}
        <ArrowUpDown size={10} className={active ? "text-indigo-500" : "text-gray-300"} />
      </span>
    </th>
  );
}
