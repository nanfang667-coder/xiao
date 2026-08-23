"use client";

import { useState } from "react";

export type MerchantCityOption = {
  value: string;
  province: string;
  city: string;
  count: number;
};

export function MerchantCityPicker({
  options,
  selectedValue,
  onSelect,
}: {
  options: MerchantCityOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === selectedValue);

  if (options.length === 0) return null;

  function chooseCity(value: string) {
    setIsOpen(false);
    onSelect(value);
  }

  return (
    <div className="mx-4 mt-4 rounded-2xl bg-white p-3 shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-1 py-1 text-left outline-none focus:outline-none"
      >
        <span className="text-sm font-bold text-gray-900">
          📍 {selected ? selected.city : "全部城市"}
        </span>
        <span className="rounded-full border border-pink-400 px-4 py-1 text-sm text-pink-500">
          {isOpen ? "收起" : "切换城市"}
        </span>
      </button>

      {isOpen && (
        <div className="grid grid-cols-3 gap-x-3 gap-y-4 px-2 pb-2 pt-4">
          <button
            type="button"
            onClick={() => chooseCity("")}
            className={`text-left text-sm ${selected ? "text-gray-800" : "font-bold text-pink-500"}`}
          >
            全部
          </button>
          {options.map((option) => {
            const active = option.value === selected?.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => chooseCity(option.value)}
                title={`${option.province} · ${option.count} 家商家`}
                className={`text-left text-sm ${active ? "font-bold text-pink-500" : "text-gray-800"}`}
              >
                {option.city}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
