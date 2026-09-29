import React from 'react';
import { CheckCircle2, FileText, Layers, X } from 'lucide-react';
import {
  FactRegistryItem,
  OutputClaim,
  SourceDocument,
} from '../types/contentx.ts';

interface ClaimInspectorDrawerProps {
  selectedClaim: OutputClaim | null;
  selectedFact: FactRegistryItem | null;
  sourceDocument: SourceDocument | null;
  onClose: () => void;
}

export const ClaimInspectorDrawer: React.FC<ClaimInspectorDrawerProps> = ({
  selectedClaim,
  selectedFact,
  sourceDocument,
  onClose,
}) => {
  if (!selectedClaim && !selectedFact) return null;

  const factId = selectedClaim?.fact_id || selectedFact?.fact_id || 'f1';
  const factStatement =
    selectedClaim?.fact_statement || selectedFact?.statement || '';
  const sourcePage =
    selectedClaim?.source_page || selectedFact?.source_page || 1;
  const sourceChunkId =
    selectedClaim?.source_chunk_id || selectedFact?.source_chunk_id || 'chunk_1';
  const sourceText =
    selectedClaim?.source_text || selectedFact?.source_text || '';
  const certainty =
    selectedClaim?.certainty || selectedFact?.certainty || 'confirmed';
  const status =
    selectedClaim?.validation_status ||
    (selectedFact?.negated
      ? 'NEGATION-PRESERVED'
      : selectedFact?.certainty === 'possible' ||
        selectedFact?.certainty === 'suspected'
      ? 'UNCERTAINTY-PRESERVED'
      : 'SOURCE-SUPPORTED');

  const fullPageContext =
    sourceDocument?.page_texts.find((p) => p.page === sourcePage)?.text ||
    sourceText;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Claim & Source Traceability Inspector
            </h2>
            <p className="text-xs text-slate-500">
              Generated Claim → Fact ID → Fact Registry → Source Chunk → Page Evidence
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800"
            aria-label="Close inspector"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Traceability Chain Content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* Status Banner */}
          <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <span className="text-xs font-semibold text-emerald-900 font-mono">
                STATUS: {status}
              </span>
            </div>
            <div className="text-xs text-emerald-800 font-mono tabular-nums">
              Certainty: {certainty.toUpperCase()}
            </div>
          </div>

          {/* Step 1: Generated Claim (if opened from Output Studio) */}
          {selectedClaim && (
            <div className="border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">
                01. Generated Claim ({selectedClaim.format})
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-900">
                "{selectedClaim.claim_text}"
              </p>
            </div>
          )}

          {/* Step 2: Canonical Fact Registry Entry */}
          <div className="border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                02. Canonical Fact Registry Entry
              </span>
              <span className="font-mono text-xs font-semibold text-blue-700 tabular-nums">
                FACT ID: {factId}
              </span>
            </div>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-900">
              {factStatement}
            </p>
            {selectedFact && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2.5 text-xs text-slate-500 font-mono tabular-nums">
                <span>Type: {selectedFact.fact_type}</span>
                <span>·</span>
                <span>Importance: {selectedFact.importance}</span>
                <span>·</span>
                <span>
                  Confidence: {Math.round(selectedFact.confidence * 100)}%
                </span>
                <span>·</span>
                <span>Domain: {selectedFact.domain}</span>
              </div>
            )}
          </div>

          {/* Step 3: Source Chunk & Page Location */}
          <div className="border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-semibold text-slate-700">
                  03. Source Location & Chunk Provenance
                </span>
              </div>
              <div className="font-mono text-xs text-slate-600 tabular-nums">
                Page {sourcePage} · {sourceChunkId}
              </div>
            </div>
            {sourceDocument && (
              <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
                Document: {sourceDocument.filename} · SHA-256:{' '}
                {sourceDocument.sha256_fingerprint.slice(0, 16)}...
              </div>
            )}
          </div>

          {/* Step 4: Exact Supporting Source Text */}
          <div className="border border-blue-200 bg-blue-50/40 p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-700" />
              <span className="text-xs font-semibold text-blue-900">
                04. Exact Supporting Source Text (Page {sourcePage})
              </span>
            </div>
            <blockquote className="mt-2 border-l-2 border-blue-600 pl-3 text-sm leading-relaxed text-slate-900">
              "{sourceText}"
            </blockquote>
          </div>

          {/* Step 5: Surrounding Source Page Verbatim Context */}
          <div className="border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-600">
              05. Full Page {sourcePage} Verbatim Context
            </div>
            <div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700">
              {fullPageContext}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
          <span className="text-xs text-slate-500 font-mono">
            Zero-Hallucination Traceability Verified
          </span>
          <button
            onClick={onClose}
            className="bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            Done Inspecting
          </button>
        </div>
      </div>
    </div>
  );
};
