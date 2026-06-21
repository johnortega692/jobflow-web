import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { WorkOrderCanvas } from "../components/workorders/WorkOrderCanvas";
import { WorkOrderEditorSidebar } from "./WorkOrderEditorSidebar";
import { TradeContractTabs } from "../components/jobinfo/TradeContractTabs";
import { useAuth } from "../contexts/AuthContext";
import {
  coerceTransmittalContract,
  hasTransmittalContractSwitch,
  transmittalPrintInfo,
} from "../lib/jobInfo";
import {
  getPdfPageCount,
  renderStoredImage,
  renderStoredPdfPage,
  renderWorkOrderBackground,
} from "../lib/workOrderBackground";
import { applyTotalsToForm, computeWorkOrderTotals, formatMoney } from "../lib/workOrderCalc";
import { exportWorkOrderPdf } from "../lib/workOrderExportPdf";
import { applyFontSettingsToOverlays } from "../lib/workOrderFonts";
import { ocrJobFromBackground } from "../lib/workOrderOcr";
import {
  detectEwoDate,
  detectEwoNumber,
  isPlaceholderEwoNumber,
  scanBoxesWithDefaultEwo,
} from "../lib/workOrderEwoDetect";
import {
  addOverlays,
  createLaborOverlay,
  createMaterialOverlay,
  ensureTotalOverlaysOnCanvas,
  initializeTotalOverlays,
  moveOverlay,
  refreshTotalOverlayAmounts,
  removeOverlay,
} from "../lib/workOrderOverlays";
import {
  applySavedTotalPositions,
  defaultTotalPositions,
  extractTotalPositionsFromOverlays,
  type WorkOrderTotalPositions,
} from "../lib/workOrderTotalPositions";
import { applyScanEnhanceToDataUrl } from "../lib/workOrderScanEnhance";
import { logProjectActivityEvent } from "../lib/projectActivity";
import { deleteWorkOrder, downloadWorkOrderSource, mimeFromStoragePath, uploadWorkOrderSource } from "../lib/workOrderStorage";
import {
  loadWorkOrderUserSettings,
  saveWorkOrderDisplayPrefs,
  saveWorkOrderScanBoxes,
  saveWorkOrderTextSpacing,
  saveWorkOrderTotalPositions,
} from "../lib/workOrderUserSettings";
import { supabase } from "../lib/supabase";
import type { Json, ProjectForm } from "../types/database";
import { normalizeProject } from "../types/database";
import { defaultWorkOrderFormData, parseWorkOrderData, type WorkOrderFormData } from "../types/workOrder";
import {
  DEFAULT_EWO_DATE_SCAN_BOX,
  DEFAULT_EWO_SCAN_BOX,
  DEFAULT_JOB_SCAN_BOX,
  DEFAULT_SCAN_ENHANCE,
  type ScanBBox,
  type ScanBoxKind,
  type WorkOrderScanBoxes,
} from "../types/workOrderScan";
import {
  defaultWorkOrderFontSettings,
  materialUnitPrice,
  type WorkOrderFontSettings,
  type WorkOrderLaborRateItem,
  type WorkOrderMaterialCatalogItem,
} from "../types/workOrderSettings";

export function WorkOrderEditorPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { projectId, workOrderId } = useParams<{ projectId: string; workOrderId: string }>();
  const uploadRef = useRef<HTMLInputElement>(null);
  const sourceBytesRef = useRef<ArrayBuffer | null>(null);
  const pristineUrlRef = useRef<string | null>(null);

  const [project, setProject] = useState<ProjectForm | null>(null);
  const [ewoNumber, setEwoNumber] = useState("001");
  const [ewoDate, setEwoDate] = useState("");
  const [delivered, setDelivered] = useState(false);
  const [form, setForm] = useState<WorkOrderFormData>(defaultWorkOrderFormData());
  const [fonts, setFonts] = useState<WorkOrderFontSettings>(defaultWorkOrderFontSettings());
  const [materials, setMaterials] = useState<WorkOrderMaterialCatalogItem[]>([]);
  const [laborRates, setLaborRates] = useState<WorkOrderLaborRateItem[]>([]);
  const [scanBoxes, setScanBoxes] = useState<WorkOrderScanBoxes>({
    ewo: null,
    job: null,
    date: null,
    template_width: 612,
    template_height: 792,
  });
  const [totalPositions, setTotalPositions] = useState<WorkOrderTotalPositions>(defaultTotalPositions());
  const [showScanBoxes, setShowScanBoxes] = useState(false);
  const [selectedScanBox, setSelectedScanBox] = useState<ScanBoxKind | null>(null);
  const [materialCategory, setMaterialCategory] = useState("");
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState("");
  const [materialQty, setMaterialQty] = useState("1");
  const [parkingAmount, setParkingAmount] = useState("");
  const [supervisionHours, setSupervisionHours] = useState("");
  const [supervisionRate, setSupervisionRate] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"controls" | "materials" | "settings" | "other">("controls");
  const [scanSetupMode, setScanSetupMode] = useState<ScanBoxKind | null>(null);

  const EWO_EDITOR_TABS = [
    { id: "controls" as const, label: "Controls" },
    { id: "materials" as const, label: "Material & Labor" },
    { id: "settings" as const, label: "Settings" },
    { id: "other" as const, label: "Other" },
  ];

  const totals = useMemo(() => computeWorkOrderTotals(form), [form]);

  const materialCategories = useMemo(() => {
    const cats = new Set(materials.map((m) => m.category || "General"));
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [materials]);

  const filteredMaterials = useMemo(() => {
    if (!materialCategory) return materials;
    return materials.filter((m) => (m.category || "General") === materialCategory);
  }, [materials, materialCategory]);

  async function applyEnhanceToBackground(pristineUrl: string, enhance: WorkOrderFormData["scan_enhance"]) {
    const enhanced = await applyScanEnhanceToDataUrl(pristineUrl, enhance);
    setBackgroundUrl(enhanced);
    return enhanced;
  }

  function setOverlays(next: WorkOrderFormData["overlays"]) {
    setForm((prev) => ({ ...prev, overlays: refreshTotalOverlayAmounts(next) }));
  }

  function placeTotalsOnCanvas(overlays: WorkOrderFormData["overlays"], positions = totalPositions) {
    return ensureTotalOverlaysOnCanvas(overlays, fonts, positions);
  }

  async function setPristineBackground(dataUrl: string, enhance: WorkOrderFormData["scan_enhance"]) {
    pristineUrlRef.current = dataUrl;
    return applyEnhanceToBackground(dataUrl, enhance);
  }

  async function runAutoDetectEwo(opts: {
    displayUrl: string;
    data: WorkOrderFormData;
    bytes: ArrayBuffer | null;
    boxes: WorkOrderScanBoxes;
    fileName?: string;
    currentEwo: string;
    currentDate: string;
    /** Always attempt detection (upload / manual read). */
    force: boolean;
  }) {
    if (!opts.force && !isPlaceholderEwoNumber(opts.currentEwo) && opts.currentDate.trim()) return;

    setOcrBusy(true);
    setError(null);
    try {
      const prepared = scanBoxesWithDefaultEwo(opts.boxes, opts.data.page_width, opts.data.page_height);
      if ((!opts.boxes.ewo && prepared.ewo) || (!opts.boxes.date && prepared.date)) {
        persistScanBoxes(prepared);
      }

      const detectInput = {
        backgroundDataUrl: opts.displayUrl,
        sourceBytes: opts.bytes,
        sourceMediaType: opts.data.source_media_type,
        sourcePdfPage: opts.data.source_pdf_page,
        pageWidth: opts.data.page_width,
        pageHeight: opts.data.page_height,
        scanBoxes: prepared,
        fileName: opts.fileName,
      };

      const shouldDetectEwo = opts.force || isPlaceholderEwoNumber(opts.currentEwo);
      const shouldDetectDate = opts.force || !opts.currentDate.trim();

      const [detectedEwo, detectedDate] = await Promise.all([
        shouldDetectEwo ? detectEwoNumber(detectInput) : Promise.resolve(null),
        shouldDetectDate ? detectEwoDate(detectInput) : Promise.resolve(null),
      ]);

      const parts: string[] = [];
      if (detectedEwo) {
        setEwoNumber(detectedEwo);
        parts.push(`EWO #${detectedEwo}`);
      }
      if (detectedDate) {
        setEwoDate(detectedDate);
        parts.push(`date ${detectedDate}`);
      }

      if (parts.length) {
        setNotice(`${parts.join(" and ")} detected from document`);
      } else if (opts.force) {
        setError(
          "Could not detect EWO # or date on this document. Adjust scan regions or enter values manually.",
        );
      }
    } catch (e) {
      if (opts.force) {
        setError(e instanceof Error ? e.message : "Auto-detect failed");
      }
    } finally {
      setOcrBusy(false);
    }
  }

  async function renderBackgroundFromBytes(data: WorkOrderFormData, bytes: ArrayBuffer): Promise<string> {
    if (data.source_media_type === "pdf") {
      const page = await renderStoredPdfPage(bytes, data.source_pdf_page, data.page_width);
      setForm((prev) => ({ ...prev, page_width: page.width, page_height: page.height }));
      return setPristineBackground(page.dataUrl, data.scan_enhance);
    }
    const mime = mimeFromStoragePath(data.source_storage_path);
    const page = await renderStoredImage(bytes, mime, data.page_width);
    setForm((prev) => ({ ...prev, page_width: page.width, page_height: page.height }));
    return setPristineBackground(page.dataUrl, data.scan_enhance);
  }

  async function loadBackgroundFromStorage(
    data: WorkOrderFormData,
    boxes?: WorkOrderScanBoxes,
    currentEwo?: string,
    currentDate?: string,
  ) {
    if (!data.source_storage_path) {
      setBackgroundUrl(null);
      pristineUrlRef.current = null;
      sourceBytesRef.current = null;
      return;
    }
    try {
      const bytes = await downloadWorkOrderSource(data.source_storage_path);
      sourceBytesRef.current = bytes;
      if (data.source_media_type === "pdf") {
        const pageCount = await getPdfPageCount(bytes);
        setForm((prev) => ({ ...prev, source_pdf_page_count: pageCount }));
      }
      const displayUrl = await renderBackgroundFromBytes(data, bytes);
      if (displayUrl) {
        await runAutoDetectEwo({
          displayUrl,
          data,
          bytes: sourceBytesRef.current,
          boxes: boxes ?? scanBoxes,
          currentEwo: currentEwo ?? ewoNumber,
          currentDate: currentDate ?? ewoDate,
          force: false,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load work order document.");
    }
  }

  useEffect(() => {
    async function load() {
      if (!projectId || !workOrderId) return;
      setLoading(true);
      const [projRes, woRes] = await Promise.all([
        supabase.from("projects").select("*").eq("id", projectId).single(),
        supabase.from("work_orders").select("*").eq("id", workOrderId).single(),
      ]);
      let woSettings: Awaited<ReturnType<typeof loadWorkOrderUserSettings>> | null = null;
      if (user?.id) {
        woSettings = await loadWorkOrderUserSettings(user.id);
        setMaterials(woSettings.materials);
        setLaborRates(woSettings.laborRates);
        setFonts(woSettings.fonts);
        setScanBoxes(woSettings.scanBoxes);
        setTotalPositions(woSettings.totalPositions);
      }
      setLoading(false);
      if (projRes.error || woRes.error) {
        setError(projRes.error?.message ?? woRes.error?.message ?? "Load failed");
        return;
      }
      const proj = normalizeProject(projRes.data);
      setProject(proj);
      const wo = woRes.data;
      setEwoNumber(wo.ewo_number ?? "001");
      setEwoDate(wo.ewo_date ?? "");
      setDelivered(Boolean(wo.delivered));
      const parsed = parseWorkOrderData(wo.data);
      parsed.contract = coerceTransmittalContract(proj, parsed.contract);
      if (woSettings && (!wo.data || typeof wo.data !== "object" || !("display" in (wo.data as object)))) {
        parsed.display = woSettings.display;
      }
      if (woSettings && (!wo.data || typeof wo.data !== "object" || !("text_spacing" in (wo.data as object)))) {
        parsed.text_spacing = woSettings.textSpacing;
      }
      setForm(parsed);
      const withTotals = placeTotalsOnCanvas(parsed.overlays, woSettings?.totalPositions ?? totalPositions);
      if (withTotals !== parsed.overlays) {
        setForm((prev) => ({ ...prev, overlays: withTotals }));
      }
      await loadBackgroundFromStorage(
        { ...parsed, overlays: withTotals },
        woSettings?.scanBoxes,
        wo.ewo_number ?? "001",
        wo.ewo_date ?? "",
      );
    }
    void load();
  }, [projectId, workOrderId, user?.id]);

  useEffect(() => {
    const pristine = pristineUrlRef.current;
    if (!pristine) return;
    void applyEnhanceToBackground(pristine, form.scan_enhance);
  }, [form.scan_enhance]);

  function setField<K extends keyof WorkOrderFormData>(key: K, value: WorkOrderFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onLaborRateChange(name: string) {
    const rate = laborRates.find((r) => r.name === name);
    if (!rate) {
      setField("labor_rate_name", name);
      return;
    }
    setForm((prev) => ({
      ...prev,
      labor_rate_name: rate.name,
      labor_billing_rate: rate.billing_rate,
      labor_raw_rate_per_hour: rate.raw_cost_per_hour || rate.billing_rate,
    }));
  }

  async function onUploadFile(file: File | null) {
    if (!file || !projectId || !workOrderId) return;
    setUploading(true);
    setError(null);
    try {
      const rendered = await renderWorkOrderBackground(file, 0);
      const { path, mediaType } = await uploadWorkOrderSource(projectId, workOrderId, file);
      const bytes = await file.arrayBuffer();
      sourceBytesRef.current = bytes;
      const displayUrl = await setPristineBackground(rendered.dataUrl, form.scan_enhance);
      const nextForm: WorkOrderFormData = {
        ...form,
        source_storage_path: path,
        source_media_type: mediaType,
        source_pdf_page: 0,
        source_pdf_page_count: rendered.pageCount,
        page_width: rendered.width,
        page_height: rendered.height,
        overlay_color: fonts.overlay_color,
        overlays: placeTotalsOnCanvas(form.overlays),
      };
      setForm(nextForm);
      await runAutoDetectEwo({
        displayUrl,
        data: nextForm,
        bytes,
        boxes: scanBoxes,
        fileName: file.name,
        currentEwo: ewoNumber,
        currentDate: ewoDate,
        force: true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  async function onPdfPageChange(pageIndex: number) {
    const bytes = sourceBytesRef.current;
    if (!bytes || form.source_media_type !== "pdf") return;
    setField("source_pdf_page", pageIndex);
    const data = { ...form, source_pdf_page: pageIndex };
    await renderBackgroundFromBytes(data, bytes);
  }

  function onInitializeTotals() {
    setOverlays(initializeTotalOverlays(form.overlays, fonts, totalPositions));
  }

  async function onSaveTotalPositionsDefault() {
    const extracted = extractTotalPositionsFromOverlays(form.overlays);
    if (Object.keys(extracted).length === 0) {
      setError("Place total fields on the document first.");
      return;
    }
    const merged = { ...defaultTotalPositions(), ...extracted };
    setTotalPositions(merged);
    if (user?.id) {
      const err = await saveWorkOrderTotalPositions(user.id, merged);
      if (err) {
        setError(err);
        return;
      }
    }
    setNotice("Saved current total positions as your default layout.");
  }

  function onRestoreTotalPositions() {
    const next = applySavedTotalPositions(form.overlays, totalPositions);
    setOverlays(refreshTotalOverlayAmounts(next));
    setNotice("Restored total fields from your saved default layout.");
  }

  function onResetFactoryTotalPositions() {
    const factory = defaultTotalPositions();
    setTotalPositions(factory);
    const next = applySavedTotalPositions(form.overlays, factory);
    setOverlays(refreshTotalOverlayAmounts(next));
    setNotice("Reset totals to factory default positions.");
  }

  function onApplyFontsToAll() {
    setOverlays(applyFontSettingsToOverlays(form.overlays, fonts));
    setField("overlay_color", fonts.overlay_color);
  }

  function onAddMaterialToCanvas() {
    const mat = materials.find((m) => m.name === selectedMaterial);
    if (!mat) {
      setError("Select a material from your library (Settings → Work orders).");
      return;
    }
    const qty = Number(materialQty) || 1;
    setError(null);
    const overlay = createMaterialOverlay({
      name: mat.name,
      unitPrice: materialUnitPrice(mat),
      quantity: qty,
      fonts,
      yOffset: form.overlays.length * 28,
    });
    setOverlays(addOverlays(form.overlays, [overlay]));
  }

  function onAddLaborToCanvas() {
    const hours = form.hours;
    const rate = form.labor_billing_rate;
    if (hours <= 0 || rate <= 0) {
      setError("Set hours and labor rate before adding labor to the document.");
      return;
    }
    setError(null);
    const overlay = createLaborOverlay({
      name: form.labor_rate_name || "Labor",
      hours,
      rate,
      fonts,
      yOffset: form.overlays.length * 28,
    });
    setOverlays(addOverlays(form.overlays, [overlay]));
  }

  function onAddParkingToCanvas() {
    const amount = Number(parkingAmount) || 0;
    if (amount <= 0) return;
    const overlay = createLaborOverlay({
      name: "Parking",
      hours: 1,
      rate: amount,
      fonts,
      yOffset: form.overlays.length * 28,
    });
    overlay.label = "Parking";
    overlay.price = "Parking";
    overlay.hours = null;
    overlay.amount = formatMoney(amount);
    setOverlays(addOverlays(form.overlays, [overlay]));
    setParkingAmount("");
  }

  function onAddSupervisionToCanvas() {
    const hours = Number(supervisionHours) || 0;
    const rate = Number(supervisionRate) || 0;
    if (hours <= 0 || rate <= 0) return;
    const overlay = createLaborOverlay({
      name: "Supervision",
      hours,
      rate,
      fonts,
      yOffset: form.overlays.length * 28,
    });
    setOverlays(addOverlays(form.overlays, [overlay]));
    setSupervisionHours("");
    setSupervisionRate("");
  }

  function onRemoveSelectedOverlay() {
    if (!selectedOverlayId) return;
    setOverlays(removeOverlay(form.overlays, selectedOverlayId));
    setSelectedOverlayId(null);
  }

  function onMoveOverlay(id: string, x: number, y: number) {
    setOverlays(moveOverlay(form.overlays, id, x, y));
  }

  function persistScanBoxes(next: WorkOrderScanBoxes) {
    setScanBoxes(next);
    if (user?.id) void saveWorkOrderScanBoxes(user.id, next);
  }

  function ensureTemplateSize(boxes: WorkOrderScanBoxes): WorkOrderScanBoxes {
    return {
      ...boxes,
      template_width: form.page_width,
      template_height: form.page_height,
    };
  }

  function onSelectEwoArea() {
    const next = ensureTemplateSize({
      ...scanBoxes,
      ewo: scanBoxes.ewo ?? { ...DEFAULT_EWO_SCAN_BOX },
    });
    persistScanBoxes(next);
    setShowScanBoxes(true);
    setSelectedScanBox("ewo");
    setScanSetupMode("ewo");
    setSelectedOverlayId(null);
    setActiveTab("settings");
  }

  function onDrawNewEwoArea() {
    const next = ensureTemplateSize({
      ...scanBoxes,
      ewo: { ...DEFAULT_EWO_SCAN_BOX },
    });
    persistScanBoxes(next);
    setShowScanBoxes(true);
    setSelectedScanBox("ewo");
    setScanSetupMode("ewo");
    setSelectedOverlayId(null);
    setActiveTab("settings");
    setNotice("Drag the red box on the document to the EWO number, then resize with the corner handles.");
  }

  function onResetEwoArea() {
    if (!scanBoxes.ewo) return;
    const next = ensureTemplateSize({
      ...scanBoxes,
      ewo: { ...DEFAULT_EWO_SCAN_BOX },
    });
    persistScanBoxes(next);
    setShowScanBoxes(true);
    setSelectedScanBox("ewo");
    setScanSetupMode("ewo");
    setActiveTab("settings");
  }

  function onSelectJobArea() {
    const next = ensureTemplateSize({
      ...scanBoxes,
      job: scanBoxes.job ?? { ...DEFAULT_JOB_SCAN_BOX },
    });
    persistScanBoxes(next);
    setShowScanBoxes(true);
    setSelectedScanBox("job");
    setScanSetupMode("job");
    setSelectedOverlayId(null);
    setActiveTab("settings");
  }

  function onDrawNewJobArea() {
    const next = ensureTemplateSize({
      ...scanBoxes,
      job: { ...DEFAULT_JOB_SCAN_BOX },
    });
    persistScanBoxes(next);
    setShowScanBoxes(true);
    setSelectedScanBox("job");
    setScanSetupMode("job");
    setSelectedOverlayId(null);
    setActiveTab("settings");
    setNotice("Drag the blue box on the document to the Job number, then resize with the corner handles.");
  }

  function onResetJobArea() {
    if (!scanBoxes.job) return;
    const next = ensureTemplateSize({
      ...scanBoxes,
      job: { ...DEFAULT_JOB_SCAN_BOX },
    });
    persistScanBoxes(next);
    setShowScanBoxes(true);
    setSelectedScanBox("job");
    setScanSetupMode("job");
    setActiveTab("settings");
  }

  function onSelectDateArea() {
    const next = ensureTemplateSize({
      ...scanBoxes,
      date: scanBoxes.date ?? { ...DEFAULT_EWO_DATE_SCAN_BOX },
    });
    persistScanBoxes(next);
    setShowScanBoxes(true);
    setSelectedScanBox("date");
    setScanSetupMode("date");
    setSelectedOverlayId(null);
    setActiveTab("settings");
  }

  function onDrawNewDateArea() {
    const next = ensureTemplateSize({
      ...scanBoxes,
      date: { ...DEFAULT_EWO_DATE_SCAN_BOX },
    });
    persistScanBoxes(next);
    setShowScanBoxes(true);
    setSelectedScanBox("date");
    setScanSetupMode("date");
    setSelectedOverlayId(null);
    setActiveTab("settings");
    setNotice("Drag the green box on the document to the EWO date, then resize with the corner handles.");
  }

  function onResetDateArea() {
    if (!scanBoxes.date) return;
    const next = ensureTemplateSize({
      ...scanBoxes,
      date: { ...DEFAULT_EWO_DATE_SCAN_BOX },
    });
    persistScanBoxes(next);
    setShowScanBoxes(true);
    setSelectedScanBox("date");
    setScanSetupMode("date");
    setActiveTab("settings");
  }

  function onFinishScanSetup() {
    setScanSetupMode(null);
    setNotice("Scan area saved. Use Auto-Detect Fields to read values from the document.");
  }

  function onClearScanBoxes() {
    persistScanBoxes(ensureTemplateSize({ ...scanBoxes, ewo: null, job: null, date: null }));
    setSelectedScanBox(null);
    setScanSetupMode(null);
  }

  function onScanBoxChange(kind: ScanBoxKind, bbox: ScanBBox) {
    const next = ensureTemplateSize({ ...scanBoxes, [kind]: bbox });
    persistScanBoxes(next);
  }

  async function onAutoDetectFields() {
    if (!backgroundUrl) {
      setError("Upload a work order document first.");
      setActiveTab("controls");
      return;
    }
    setActiveTab("controls");
    await onOcrEwo();
    if (scanBoxes.job) {
      setOcrBusy(true);
      try {
        const job = await ocrJobFromBackground(backgroundUrl, scanBoxes);
        if (job) setNotice((prev) => `${prev ? `${prev} · ` : ""}Job ${job} detected`);
      } catch {
        // Job detection is optional
      } finally {
        setOcrBusy(false);
      }
    }
  }

  async function onOcrEwo() {
    if (!backgroundUrl) {
      setError("Upload a work order document first.");
      return;
    }
    await runAutoDetectEwo({
      displayUrl: backgroundUrl,
      data: form,
      bytes: sourceBytesRef.current,
      boxes: scanBoxes,
      currentEwo: ewoNumber,
      currentDate: ewoDate,
      force: true,
    });
  }

  function onResetScanEnhance() {
    setField("scan_enhance", { ...DEFAULT_SCAN_ENHANCE });
  }

  async function onSave() {
    if (!workOrderId) return;
    setSaving(true);
    setError(null);

    const refreshed = refreshTotalOverlayAmounts(form.overlays);
    const withOverlays = { ...form, overlays: refreshed, overlay_color: fonts.overlay_color };
    const finalForm = applyTotalsToForm(withOverlays);
    setForm(finalForm);

    const { error: err } = await supabase
      .from("work_orders")
      .update({
        ewo_number: ewoNumber,
        ewo_date: ewoDate,
        delivered,
        total_amount: finalForm.total_amount,
        material_cost: finalForm.material_cost,
        labor_cost: finalForm.labor_cost,
        data: finalForm as unknown as Json,
        status: "draft",
      })
      .eq("id", workOrderId);

    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSavedAt(new Date().toLocaleTimeString());
    if (projectId) {
      await logProjectActivityEvent({
        projectId,
        action: "work_order_saved",
        summary: `EWO #${ewoNumber} saved`,
      });
    }
    if (user?.id) {
      void saveWorkOrderDisplayPrefs(user.id, finalForm.display);
      void saveWorkOrderTextSpacing(user.id, finalForm.text_spacing);
    }
  }

  const contractJob = useMemo(
    () => (project ? transmittalPrintInfo(project, form.contract) : { job_number: "", job_name: "" }),
    [project, form.contract],
  );

  async function onExportPdf() {
    setExporting(true);
    setError(null);
    try {
      let bytes = sourceBytesRef.current;
      if (!bytes && form.source_storage_path) {
        bytes = await downloadWorkOrderSource(form.source_storage_path);
        sourceBytesRef.current = bytes;
      }
      const safeJob = (contractJob.job_number || "job").replace(/[^\w.-]+/g, "_");
      await exportWorkOrderPdf({
        sourceBytes: bytes,
        sourceMediaType: form.source_media_type,
        pageWidth: form.page_width,
        pageHeight: form.page_height,
        sourcePdfPage: form.source_pdf_page,
        overlays: form.overlays,
        display: form.display,
        backgroundDataUrl: backgroundUrl,
        textSpacing: form.text_spacing,
        filename: `${safeJob} EWO ${ewoNumber}.pdf`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function onDelete() {
    if (!workOrderId || !projectId) return;
    if (
      !window.confirm(
        `Delete EWO #${ewoNumber}? This removes the work order and any uploaded PDF/image.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteWorkOrder(workOrderId, form);
      await logProjectActivityEvent({
        projectId,
        action: "work_order_deleted",
        summary: `EWO #${ewoNumber} deleted`,
      });
      navigate(`/projects/${projectId}/work-orders`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete work order.");
      setDeleting(false);
    }
  }

  const scanSetupHint =
    scanSetupMode === "ewo"
      ? "EWO scan area — drag the red box over the Extra Work Order #, resize with corner handles."
      : scanSetupMode === "job"
        ? "Job scan area — drag the blue box over the Job #, resize with corner handles."
        : scanSetupMode === "date"
          ? "Date scan area — drag the green box over the EWO date field, resize with corner handles."
          : null;

  if (loading) return <p className="muted">Loading work order…</p>;
  if (!project) return <p className="banner banner-error">{error ?? "Not found"}</p>;

  const pdfPages = form.source_media_type === "pdf" ? form.source_pdf_page_count : 0;
  const hasTotalOverlays = form.overlays.some((o) => o.section === "total");

  return (
    <div className="ewo-editor-page">
      <div className="page-header">
        <div>
          <p className="breadcrumb">
            <Link to="/projects">Projects</Link> /{" "}
            <Link to={`/projects/${projectId}/work-orders`}>{contractJob.job_number || project.job_number}</Link> / EWO {ewoNumber}
          </p>
          <h1>EWO {ewoNumber}</h1>
          <p className="muted">{contractJob.job_name || project.job_name}</p>
          {hasTransmittalContractSwitch(project) && (
            <TradeContractTabs
              project={project}
              value={form.contract}
              onChange={(contract) => setField("contract", contract)}
            />
          )}
        </div>
        <div className="row-gap wrap">
          {savedAt && <span className="muted small">Saved {savedAt}</span>}
          <input
            ref={uploadRef}
            type="file"
            hidden
            accept=".pdf,image/*"
            onChange={(e) => {
              void onUploadFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={uploading}
            onClick={() => uploadRef.current?.click()}
          >
            {uploading
              ? "Uploading…"
              : form.source_storage_path
                ? "Replace work order"
                : "Upload work order"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={exporting || !form.overlays.length}
            onClick={() => void onExportPdf()}
          >
            {exporting ? "Exporting…" : "Export PDF"}
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save EWO"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-danger-soft"
            disabled={deleting || saving}
            onClick={() => void onDelete()}
          >
            {deleting ? "Deleting…" : "Delete EWO"}
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner banner-ok">{notice}</div>}

      <div className="ewo-editor-layout">
        <WorkOrderEditorSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          tabs={EWO_EDITOR_TABS}
          hasDocument={Boolean(form.source_storage_path)}
          pdfPages={pdfPages}
          sourcePdfPage={form.source_pdf_page}
          onPdfPageChange={(page) => void onPdfPageChange(page)}
          ewoNumber={ewoNumber}
          onEwoNumberChange={setEwoNumber}
          ewoDate={ewoDate}
          onEwoDateChange={setEwoDate}
          projectJobNumber={contractJob.job_number || project.job_number}
          ocrBusy={ocrBusy}
          scanBoxes={scanBoxes}
          showScanBoxes={showScanBoxes}
          onShowScanBoxesChange={setShowScanBoxes}
          scanSetupMode={scanSetupMode}
          onSelectEwoArea={onSelectEwoArea}
          onDrawNewEwoArea={onDrawNewEwoArea}
          onResetEwoArea={onResetEwoArea}
          onSelectJobArea={onSelectJobArea}
          onDrawNewJobArea={onDrawNewJobArea}
          onResetJobArea={onResetJobArea}
          onSelectDateArea={onSelectDateArea}
          onDrawNewDateArea={onDrawNewDateArea}
          onResetDateArea={onResetDateArea}
          onClearScanBoxes={onClearScanBoxes}
          onFinishScanSetup={onFinishScanSetup}
          onAutoDetectFields={() => void onAutoDetectFields()}
          form={form}
          onFieldChange={setField}
          onResetScanEnhance={onResetScanEnhance}
          onInitializeTotals={onInitializeTotals}
          onSaveTotalPositionsDefault={() => void onSaveTotalPositionsDefault()}
          onRestoreTotalPositions={onRestoreTotalPositions}
          onResetFactoryTotalPositions={onResetFactoryTotalPositions}
          hasTotalOverlays={hasTotalOverlays}
          onApplyFontsToAll={onApplyFontsToAll}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={setSelectedOverlayId}
          onRemoveSelectedOverlay={onRemoveSelectedOverlay}
          materials={materials}
          materialCategories={materialCategories}
          materialCategory={materialCategory}
          onMaterialCategoryChange={setMaterialCategory}
          filteredMaterials={filteredMaterials}
          selectedMaterial={selectedMaterial}
          onSelectedMaterialChange={setSelectedMaterial}
          materialQty={materialQty}
          onMaterialQtyChange={setMaterialQty}
          onAddMaterialToCanvas={onAddMaterialToCanvas}
          laborRates={laborRates}
          onLaborRateChange={onLaborRateChange}
          onAddLaborToCanvas={onAddLaborToCanvas}
          parkingAmount={parkingAmount}
          onParkingAmountChange={setParkingAmount}
          onAddParkingToCanvas={onAddParkingToCanvas}
          supervisionHours={supervisionHours}
          onSupervisionHoursChange={setSupervisionHours}
          supervisionRate={supervisionRate}
          onSupervisionRateChange={setSupervisionRate}
          onAddSupervisionToCanvas={onAddSupervisionToCanvas}
          fonts={fonts}
          onFontsChange={setFonts}
          delivered={delivered}
          onDeliveredChange={setDelivered}
          totals={totals}
          backgroundUrl={backgroundUrl}
        />

        <div className="ewo-canvas-panel card">
          <WorkOrderCanvas
            backgroundUrl={backgroundUrl}
            pageWidth={form.page_width}
            pageHeight={form.page_height}
            overlays={form.overlays}
            display={form.display}
            textSpacing={form.text_spacing}
            selectedId={selectedOverlayId}
            onSelect={setSelectedOverlayId}
            onMove={onMoveOverlay}
            scanBoxes={scanBoxes}
            showScanBoxes={showScanBoxes || scanSetupMode !== null}
            selectedScanBox={selectedScanBox}
            onSelectScanBox={setSelectedScanBox}
            onScanBoxChange={onScanBoxChange}
            scanSetupHint={scanSetupHint}
          />
        </div>
      </div>
    </div>
  );
}
