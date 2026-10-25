"use client";

import { useRef, useState } from "react";
import { ImageCollector } from "./ImageCollector";
import { SourceSettings } from "./ImportForms";

type Source = { id: number; name: string; origin: string; rules: string; imageOrigins: string };

export function PartnerImagesWorkspace({ sources, defaultRules }: { sources: Source[]; defaultRules: string }) {
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const settings = useRef<HTMLDivElement>(null);

  function editSource(id: number) {
    if (!Number.isSafeInteger(id) || id < 1 || !sources.some(source => source.id === id)) return;
    setSelectedSourceId(String(id));
    settings.current?.querySelectorAll<HTMLDetailsElement>("details").forEach(details => { details.open = true; });
    settings.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectSource(id: string) {
    if (id === "" || sources.some(source => String(source.id) === id)) setSelectedSourceId(id);
  }

  return <div className="space-y-4">
    <ImageCollector sources={sources.map(({ id, name, origin }) => ({ id, name, origin }))} onEditSource={editSource} />
    <div ref={settings} className="scroll-mt-4">
      <SourceSettings sources={sources} defaultRules={defaultRules} selectedSourceId={selectedSourceId} onSelectSource={selectSource} />
    </div>
  </div>;
}
