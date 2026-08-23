"use client";

import { useEffect, useMemo, useState } from "react";
import { MerchantCard, type MerchantCardData } from "@/components/MerchantCard";
import { MerchantCityPicker, type MerchantCityOption } from "./MerchantCityPicker";

export function MerchantBrowser({
  options,
  merchants,
  initialSelectedValue,
}: {
  options: MerchantCityOption[];
  merchants: MerchantCardData[];
  initialSelectedValue: string;
}) {
  const [selectedValue, setSelectedValue] = useState(initialSelectedValue);

  useEffect(() => {
    function handlePopState() {
      const requested = new URLSearchParams(window.location.search).get("city") ?? "";
      setSelectedValue(options.some((option) => option.value === requested) ? requested : "");
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [options]);

  const visibleMerchants = useMemo(
    () =>
      selectedValue
        ? merchants.filter((merchant) => `${merchant.city}::${merchant.district}` === selectedValue)
        : merchants,
    [merchants, selectedValue],
  );

  function selectCity(value: string) {
    setSelectedValue(value);
    window.history.pushState(null, "", value ? `/spa?city=${encodeURIComponent(value)}` : "/spa");
  }

  return (
    <>
      <MerchantCityPicker options={options} selectedValue={selectedValue} onSelect={selectCity} />

      <div className="space-y-3 px-4 pt-4">
        {visibleMerchants.length === 0 ? (
          <p className="py-20 text-center text-sm text-gray-400">暂时还没有公开商家</p>
        ) : (
          visibleMerchants.map((merchant) => <MerchantCard key={merchant.id} merchant={merchant} />)
        )}
      </div>
    </>
  );
}
