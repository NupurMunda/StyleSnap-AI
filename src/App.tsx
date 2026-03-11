/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Upload, 
  Sparkles, 
  Trash2, 
  RefreshCw, 
  Heart,
  ShoppingBag,
  Star,
  Zap,
  X,
  Minus,
  Square,
  FileText,
  Search,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

type Tab = 'ANALYSE' | 'SHOP' | 'DEEP_DIVE';

interface RateLimit {
  count: number;
  lastReset: number;
}

const SCAN_LIMIT = 3;
const RESET_TIME = 24 * 60 * 60 * 1000; // 24 hours

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('ANALYSE');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState('');
  
  // Results
  const [identityResult, setIdentityResult] = useState<{ [key: string]: string } | null>(null);
  const [shopResult, setShopResult] = useState<string | null>(null);
  const [deepDiveResult, setDeepDiveResult] = useState<string | null>(null);
  const [showOverload, setShowOverload] = useState(false);
  const [showQuotaError, setShowQuotaError] = useState(false);

  const compressImage = (base64: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxWidth = 800;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = base64;
    });
  };

  // Photos
  const [idPhotos, setIdPhotos] = useState<(string | null)[]>([null, null]);
  const [shopPhoto, setShopPhoto] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ type: 'ID' | 'SHOP', index?: number } | null>(null);

  // Load state from localStorage
  useEffect(() => {
    const savedPrefs = localStorage.getItem('userPrefs');
    const savedAnalysis = localStorage.getItem('analysisResult');
    const savedPhotos = localStorage.getItem('stylesnap_photos');

    if (savedPrefs) setPreferences(savedPrefs);
    if (savedAnalysis) {
      const parsed = JSON.parse(savedAnalysis);
      setIdentityResult(parsed.identityResult);
      setDeepDiveResult(parsed.deepDiveResult);
    }
    if (savedPhotos) {
      const parsed = JSON.parse(savedPhotos);
      if (parsed.idPhotos) setIdPhotos(parsed.idPhotos);
      if (parsed.shopPhoto) setShopPhoto(parsed.shopPhoto);
    }
  }, []);

  // Save state to localStorage
  const saveAppState = (prefs: string, idRes: any, ddRes: any, photos: any) => {
    const attemptSave = () => {
      localStorage.setItem('userPrefs', prefs);
      if (idRes || ddRes) {
        localStorage.setItem('analysisResult', JSON.stringify({ identityResult: idRes, deepDiveResult: ddRes }));
      }
      localStorage.setItem('stylesnap_photos', JSON.stringify(photos));
    };

    try {
      attemptSave();
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        // Automatically clear old data to make room for the new scan
        localStorage.removeItem('stylesnap_photos');
        localStorage.removeItem('analysisResult');
        try {
          attemptSave();
        } catch (retryError) {
          setShowQuotaError(true);
        }
      }
    }
  };

  const clearAllData = () => {
    localStorage.removeItem('userPrefs');
    localStorage.removeItem('analysisResult');
    localStorage.removeItem('stylesnap_photos');
    setPreferences('');
    setIdentityResult(null);
    setDeepDiveResult(null);
    setIdPhotos([null, null]);
    setShopPhoto(null);
    setShowQuotaError(false);
  };

  const getRateLimit = (): RateLimit => {
    const saved = localStorage.getItem('stylesnap_v4_limit');
    if (saved) {
      const limit: RateLimit = JSON.parse(saved);
      if (Date.now() - limit.lastReset > RESET_TIME) {
        return { count: 0, lastReset: Date.now() };
      }
      return limit;
    }
    return { count: 0, lastReset: Date.now() };
  };

  const incrementLimit = () => {
    const limit = getRateLimit();
    limit.count += 1;
    localStorage.setItem('stylesnap_v4_limit', JSON.stringify(limit));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadTarget) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const rawBase64 = reader.result as string;
        const compressedBase64 = await compressImage(rawBase64);
        
        if (uploadTarget.type === 'ID' && uploadTarget.index !== undefined) {
          const newPhotos = [...idPhotos];
          newPhotos[uploadTarget.index] = compressedBase64;
          setIdPhotos(newPhotos);
          saveAppState(preferences, identityResult, deepDiveResult, { idPhotos: newPhotos, shopPhoto });
        } else if (uploadTarget.type === 'SHOP') {
          setShopPhoto(compressedBase64);
          saveAppState(preferences, identityResult, deepDiveResult, { idPhotos, shopPhoto: compressedBase64 });
        }
        setUploadTarget(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerUpload = (type: 'ID' | 'SHOP', index?: number) => {
    setUploadTarget({ type, index });
    fileInputRef.current?.click();
  };

  const runAnalyseMe = async () => {
    const photos = idPhotos.filter(p => p !== null);
    if (photos.length < 2) {
      setError("Babe! I need both a face-up and a full-body photo to work my magic! 💖✨");
      return;
    }

    const limit = getRateLimit();
    if (limit.count >= SCAN_LIMIT) {
      setShowOverload(true);
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const imageParts = photos.map(p => ({
        inlineData: {
          data: p!.split(',')[1],
          mimeType: p!.split(';')[0].split(':')[1]
        }
      }));

      // Simultaneous generation of Table and Manual
      const [tableResponse, manualResponse] = await Promise.all([
        ai.models.generateContent({
          model: "gemini-3-flash-preview",
          config: { responseMimeType: "application/json" },
          contents: [{
            parts: [
              { text: `ROLE: You are the "StyleSnap AI Engine," a professional image consultant trained in the Kibbe body typing system, Kitchener essence system, and seasonal color analysis.

### PART 1 — KIBBE BODY TYPE IDENTIFICATION (THE LOGIC)
You MUST evaluate the user's photos using this specific sequence:
1. VERTICAL LINE: Evaluate visual elongation (Long, Moderate, or Short). Height alone does not determine this.
2. BONE STRUCTURE: Analyze shoulders/limbs (Sharp Yang, Broad/Blunt Natural Yang, Delicate Yin, or Balanced).
3. FLESH DISTRIBUTION: Determine if flesh is Soft Yin, Lean Yang, or Balanced.
4. DOMINANCE: Is it Curve Dominant, Frame Dominant, or Balanced?
5. FINAL FAMILY MAPPING: 
   - Short vertical + delicate bones + softness → Soft Gamine.
   - Short vertical + mixed yin/yang → Gamine.
   - (Refer to full Kibbe mapping logic for all other types).

### PART 2 — KITCHENER ESSENCE IDENTIFICATION
Analyze facial proportions, eye spacing, and jaw shape from the face-up photo.
- Blend 2-3 essences (Dramatic, Natural, Classic, Gamine, Romantic, Ingenue, Ethereal).
- Rule: Youthful features indicate Ingenue; Curved features indicate Romantic.

### PART 3 — SEASONAL COLOR ANALYSIS
Analyze Skin undertone, Depth, Contrast, and Chroma.
- Deep Autumn: Warm undertone + deep coloring.

STRICT ANALYSIS RULES:
1. KIBBE VS ESSENCE: Always distinguish between the Body Frame (Kibbe) and the Facial/Vibe Essence (Kitchener).
2. THE ROMANTIC-INGENUE BLEND: If a user has Romantic + Ingenue essence, emphasize 'Lush Sweetness' and 'Soft Glamour.'
3. THE GAMINE FRAME: Even if the essence is soft, if the frame is GAMINE, the advice MUST include 'Broken Lines,' 'Cuffed Sleeves,' and 'Animated Detail' to avoid the user looking overwhelmed by soft fabrics.
4. CORRECTION: If the user identifies as Gamine + Ingenue + Romantic, do not use the term 'Soft Ingenue.' Use 'Gamine-Coquette' or 'Lush Gamine.'

IMPORTANT GUARDRAILS:
- Never determine body type based solely on height or weight.
- Never assume petite = gamine or curvy = romantic.
- Cross-reference user text preferences (e.g., "I love lace") as the ROOTS in the table.

TASK: Analyze the user's style identity based on the photos and their preferences.
USER PREFERENCES: ${preferences}

OUTPUT FORMAT: You MUST return a JSON object with these exact keys:
{
  "BODY TYPE": "[Kibbe Type]",
  "SEASON": "[Color Palette]",
  "ESSENCE": "[Kitchener Breakdown]",
  "ROOTS": "[Include the user's preferences: ${preferences} + style keywords]",
  "CELEB TWIN": "[Name]"
}` },
              ...imageParts
            ]
          }]
        }),
        ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{
            parts: [
              { text: `ROLE: You are the "StyleSnap AI Engine," a professional image consultant. Your tone is "90s fashion bestie."

TASK: Provide a detailed "Bestie Manual" based on the logic of Kibbe, Kitchener, and Seasonal Color Analysis.
CONSTRAINTS: Use BOLD PINK CAPS for all item recommendations and ICONIC swaps.

OUTPUT FORMAT:
### THE VERDICT
A deep-dive paragraph explaining the "why" behind their frame and essence (e.g., "The 'broken line' created by your frame...").

### COLOR STORY
Why their palette works and specific ICONIC swaps in BOLD PINK CAPS (e.g., SWAP BLUE FOR BURNT ORANGE).

### ACCESSORY UPGRADE
Suggest specific 90s details in BOLD PINK CAPS (e.g., BUTTERFLY CLIPS, CHUNKY LOAFERS).

### EMPOWERMENT
"You are a total star, bestie! 💖✨"` },
              ...imageParts
            ]
          }]
        })
      ]);

      const tableJson = JSON.parse(tableResponse.text || "{}");
      const manualText = manualResponse.text || "Oops! The manual failed to print! 🎀";
      
      setIdentityResult(tableJson);
      setDeepDiveResult(manualText);
      saveAppState(preferences, tableJson, manualText, { idPhotos, shopPhoto });
      incrementLimit();
    } catch (err: any) {
      setError("Ugh, system crash! " + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const runShopSure = async () => {
    if (!shopPhoto) {
      setError("Babe, show me the goods! Upload a photo of the item! 👗✨");
      return;
    }

    if (!identityResult) {
      setError("System Error! Run Identity Scan first! 💖");
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const imagePart = {
        inlineData: {
          data: shopPhoto.split(',')[1],
          mimeType: shopPhoto.split(';')[0].split(':')[1]
        }
      };

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{
          parts: [
            { text: `ROLE: 90s fashion bestie. 
            CONTEXT: The user's identity is: ${JSON.stringify(identityResult)}. 
            TASK: Evaluate this new clothing item for them. 
            OUTPUT FORMAT:
            - MATCH SCORE: [X/10] 🌟
            - VERDICT: 1-sentence decision (e.g., "Totally You!").
            - THE HACK: 1-sentence style tip.` },
            imagePart
          ]
        }]
      });

      setShopResult(response.text || "System error! 💖");
    } catch (err: any) {
      setError("System glitch! " + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const runDeepDive = async () => {
    if (!identityResult) {
      setError("System Error! Run Identity Scan first! 💖");
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{
          parts: [
            { text: `ROLE: 90s fashion bestie. 
            CONTEXT: The user's identity is: ${JSON.stringify(identityResult)}. 
            TASK: Provide a detailed "Deep Dive" explanation.
            CONSTRAINTS: Use BOLD PINK CAPS for all item recommendations and accessory upgrades.
            OUTPUT FORMAT:
            - THE VERDICT: A deep paragraph explaining the harmony of their lines/essence.
            - COLOUR STORY: Explain why their Season works and suggest iconic color swaps.
            - STYLE HACK (ICONIC): Specific item upgrades in BOLD PINK CAPS (e.g., CHUNKY LOAFERS).
            - EMPOWERMENT: End with: "You are a total star, bestie! 💖✨"` }
          ]
        }]
      });

      setDeepDiveResult(response.text || "System error! 💖");
    } catch (err: any) {
      setError("System glitch! " + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const limit = getRateLimit();

  return (
    <div className="p-4 md:p-8 flex flex-col items-center">
      {/* App Header */}
      <div className="w-full max-w-4xl mb-8 flex flex-col items-center">
        <h1 className="text-4xl md:text-6xl font-black text-barbie-pink italic tracking-tighter drop-shadow-[2px_2px_0px_rgba(0,0,0,1)] mb-2">
          STYLESNAP AI
        </h1>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-dark-blue">
          V4.0 • STYLE_ENGINE.EXE
        </p>
      </div>

      {/* Main Window */}
      <div className="w-full max-w-4xl retro-window">
        {/* Title Bar */}
        <div className="retro-title-bar">
          <div className="flex items-center gap-2">
            <Sparkles size={14} />
            <span>StyleSnap_Bestie.exe</span>
          </div>
          <div className="flex gap-1">
            <div className="w-4 h-4 bg-retro-grey border border-gray-600 flex items-center justify-center text-black text-[10px]"><Minus size={10}/></div>
            <div className="w-4 h-4 bg-retro-grey border border-gray-600 flex items-center justify-center text-black text-[10px]"><Square size={8}/></div>
            <div className="w-4 h-4 bg-retro-grey border border-gray-600 flex items-center justify-center text-black text-[10px]"><X size={10}/></div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-2 pt-2 gap-1 bg-retro-grey border-b-2 border-gray-600">
          <button 
            onClick={() => setActiveTab('ANALYSE')}
            className={`retro-tab ${activeTab === 'ANALYSE' ? 'retro-tab-active' : ''}`}
          >
            [ANALYSE_ME.EXE]
          </button>
          <button 
            onClick={() => setActiveTab('SHOP')}
            className={`retro-tab ${activeTab === 'SHOP' ? 'retro-tab-active' : ''}`}
          >
            [SHOP_SURE.EXE]
          </button>
          <button 
            onClick={() => setActiveTab('DEEP_DIVE')}
            className={`retro-tab ${activeTab === 'DEEP_DIVE' ? 'retro-tab-active' : ''}`}
          >
            [DEEP_DIVE.DOC]
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 bg-retro-grey">
          <AnimatePresence mode="wait">
            {activeTab === 'ANALYSE' && (
              <motion.div 
                key="analyse"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                {!identityResult ? (
                  <>
                    <div className="text-center mb-4">
                      <h2 className="text-xl font-bold text-dark-blue italic">✨ ANALYSE_ME.EXE ✨</h2>
                      <p className="text-xs text-gray-600">Upload Face-up and Full-body photos! 💖</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {idPhotos.map((photo, i) => (
                        <div key={i} className="retro-inset aspect-square flex flex-col items-center justify-center relative overflow-hidden group">
                          {photo ? (
                            <>
                              <img src={photo} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              <button 
                                onClick={() => {
                                  const next = [...idPhotos];
                                  next[i] = null;
                                  setIdPhotos(next);
                                  saveAppState(preferences, identityResult, deepDiveResult, { idPhotos: next, shopPhoto });
                                }}
                                className="absolute top-2 right-2 p-1 bg-white/80 text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : (
                            <button 
                              onClick={() => triggerUpload('ID', i)}
                              className="flex flex-col items-center gap-2 text-gray-400 hover:text-barbie-pink transition-colors"
                            >
                              <Upload size={32} />
                              <span className="text-[10px] font-bold uppercase">{i === 0 ? 'Face-up' : 'Full-body'}</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase text-dark-blue">Style Preferences (e.g., "I love lace and ruffles")</label>
                      <textarea 
                        value={preferences}
                        onChange={(e) => {
                          setPreferences(e.target.value);
                          saveAppState(e.target.value, identityResult, deepDiveResult, { idPhotos, shopPhoto });
                        }}
                        placeholder="Tell me your vibe, babe! ✨"
                        className="w-full retro-inset h-20 text-sm focus:outline-none resize-none"
                      />
                    </div>

                    <div className="flex flex-col items-center gap-4">
                      <button 
                        onClick={runAnalyseMe}
                        disabled={analyzing || limit.count >= SCAN_LIMIT}
                        className="retro-button w-full max-w-xs flex items-center justify-center gap-2"
                      >
                        {analyzing ? <RefreshCw className="animate-spin" /> : <Zap size={18} />}
                        SCAN MY STYLE!
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center w-full">
                    <div className="retro-inset w-full bg-white">
                      <div className="flex flex-col">
                        {Object.entries(identityResult).map(([label, value]) => (
                          <div key={label} className="retro-row">
                            <span className="retro-row-label">{label}</span>
                            <span className="retro-row-value">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        setIdentityResult(null);
                        setDeepDiveResult(null);
                        saveAppState(preferences, null, null, { idPhotos, shopPhoto });
                      }}
                      className="mt-6 text-[10px] font-bold uppercase text-dark-blue hover:underline flex items-center gap-1"
                    >
                      <RefreshCw size={10} />
                      New Scan
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'SHOP' && (
              <motion.div 
                key="shop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="text-center mb-4">
                  <h2 className="text-xl font-bold text-dark-blue italic">👗 SHOP_SURE.EXE 👗</h2>
                  <p className="text-xs text-gray-600">Check a new item against your lines! 🌟</p>
                </div>

                {!identityResult ? (
                  <div className="retro-inset bg-red-50 border-red-200 text-red-600 text-center py-8">
                    <AlertTriangle className="mx-auto mb-2" />
                    <p className="font-bold">System Error! Run Identity Scan first! 💖</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-6">
                    <div className="retro-inset w-full max-w-sm aspect-[4/3] flex flex-col items-center justify-center relative overflow-hidden group">
                      {shopPhoto ? (
                        <>
                          <img src={shopPhoto} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          <button 
                            onClick={() => setShopPhoto(null)}
                            className="absolute top-2 right-2 p-1 bg-white/80 text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : (
                        <button 
                          onClick={() => triggerUpload('SHOP')}
                          className="flex flex-col items-center gap-2 text-gray-400 hover:text-barbie-pink transition-colors"
                        >
                          <ShoppingBag size={48} />
                          <span className="text-[10px] font-bold uppercase">Upload Item Photo</span>
                        </button>
                      )}
                    </div>

                    <button 
                      onClick={runShopSure}
                      disabled={analyzing}
                      className="retro-button w-full max-w-xs flex items-center justify-center gap-2"
                    >
                      {analyzing ? <RefreshCw className="animate-spin" /> : <Search size={18} />}
                      IS THIS ME?
                    </button>

                    {shopResult && (
                      <div className="retro-inset w-full bg-white">
                        <div className="prose prose-sm prose-pink max-w-none">
                          <ReactMarkdown>
                            {shopResult}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'DEEP_DIVE' && (
              <motion.div 
                key="dive"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="text-center mb-4">
                  <h2 className="text-xl font-bold text-dark-blue italic">📖 DEEP_DIVE.DOC 📖</h2>
                  <p className="text-xs text-gray-600">The ultimate style manual for your gorgeous self! ✨</p>
                </div>

                {!identityResult ? (
                  <div className="retro-inset bg-red-50 border-red-200 text-red-600 text-center py-8">
                    <AlertTriangle className="mx-auto mb-2" />
                    <p className="font-bold">System Error! Run Identity Scan first! 💖</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-6">
                    {!deepDiveResult && (
                      <button 
                        onClick={runDeepDive}
                        disabled={analyzing}
                        className="retro-button w-full max-w-xs flex items-center justify-center gap-2"
                      >
                        {analyzing ? <RefreshCw className="animate-spin" /> : <FileText size={18} />}
                        GENERATE MY MANUAL!
                      </button>
                    )}

                    {deepDiveResult && (
                      <div className="retro-inset w-full bg-white max-h-[500px] overflow-auto">
                        <div className="prose prose-sm prose-pink max-w-none deep-dive-content">
                          <ReactMarkdown 
                            components={{
                              strong: ({node, ...props}) => <span className="bold-pink-caps" {...props} />
                            }}
                          >
                            {deepDiveResult}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Message */}
          {error && (
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="mt-6 p-4 bg-red-100 border-2 border-red-400 text-red-700 text-sm font-bold flex items-start gap-3"
            >
              <AlertTriangle className="shrink-0 mt-1" size={16} />
              <p>{error}</p>
            </motion.div>
          )}
        </div>

        {/* Status Bar */}
        <div className="bg-retro-grey border-t-2 border-white px-2 py-1 flex justify-between items-center text-[10px] font-bold text-gray-600">
          <div className="flex gap-4 items-center">
            <span>SCANS: {limit.count}/{SCAN_LIMIT}</span>
            <span className="animate-pulse text-green-600">SYSTEM_READY</span>
            <button 
              onClick={clearAllData}
              className="hover:text-red-500 transition-colors flex items-center gap-1 border-l border-gray-400 pl-4"
            >
              <Trash2 size={10} />
              CLEAR_DATA
            </button>
          </div>
          <div className="flex items-center gap-1">
            <Heart size={10} fill="currentColor" className="text-barbie-pink" />
            <span>BESTIE_MODE_ON</span>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        className="hidden" 
      />

      {/* Ad Slot */}
      <div className="w-full max-w-4xl ad-slot retro-window">
        <div className="ad-label">SPONSORED_DEAL.EXE</div>
        <div className="flex items-center gap-4 px-6">
          <div className="w-12 h-12 bg-barbie-pink rounded-full flex items-center justify-center text-white">
            <Sparkles size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-dark-blue uppercase">Get 20% off at The Gap!</p>
            <p className="text-[10px] text-gray-500">Use code: BESTIE99 at checkout. ✨</p>
          </div>
        </div>
      </div>

      {/* System Overload Modal */}
      <AnimatePresence>
        {showOverload && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md retro-window"
            >
              <div className="retro-title-bar bg-red-700">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} />
                  <span>SYSTEM_OVERLOAD.EXE</span>
                </div>
                <button onClick={() => setShowOverload(false)} className="w-4 h-4 bg-retro-grey border border-gray-600 flex items-center justify-center text-black text-[10px]"><X size={10}/></button>
              </div>
              <div className="p-8 bg-retro-grey text-center space-y-4">
                <div className="text-red-600 flex justify-center">
                  <AlertTriangle size={48} />
                </div>
                <h3 className="text-xl font-bold text-dark-blue uppercase tracking-tight">Style Energy Depleted!</h3>
                <p className="text-sm text-gray-700">
                  Ugh, babe! You've scanned too many looks today. The Style Engine is literally smoking! 🛑✨
                </p>
                <p className="text-xs text-gray-500 italic">
                  Come back in 24 hours for more iconic fashion magic.
                </p>
                <button 
                  onClick={() => setShowOverload(false)}
                  className="retro-button w-full"
                >
                  OKAY, BESTIE! 🎀
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Quota Exceeded Modal */}
      <AnimatePresence>
        {showQuotaError && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md retro-window"
            >
              <div className="retro-title-bar bg-orange-600">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} />
                  <span>DISK_FULL_ERROR.EXE</span>
                </div>
                <button onClick={() => setShowQuotaError(false)} className="w-4 h-4 bg-retro-grey border border-gray-600 flex items-center justify-center text-black text-[10px]"><X size={10}/></button>
              </div>
              <div className="p-8 bg-retro-grey text-center space-y-4">
                <div className="text-orange-600 flex justify-center">
                  <AlertTriangle size={48} />
                </div>
                <h3 className="text-xl font-bold text-dark-blue uppercase tracking-tight">Memory Full, Bestie!</h3>
                <p className="text-sm text-gray-700">
                  Ugh, your style files are literally too big for this computer! 🛑✨ We need to clear some space to save new looks.
                </p>
                <p className="text-xs text-gray-500 italic">
                  Clearing data will remove your saved photos and analysis.
                </p>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowQuotaError(false)}
                    className="retro-button flex-1 bg-gray-200"
                  >
                    CANCEL
                  </button>
                  <button 
                    onClick={clearAllData}
                    className="retro-button flex-1 bg-red-500 text-white"
                  >
                    CLEAR ALL DATA 🗑️
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-8 text-center">
        <p className="text-[10px] font-bold text-dark-blue/40 uppercase tracking-[0.4em]">
          © 1999 StyleSnap AI • Totally Rad Tech
        </p>
      </footer>

      <style>{`
        .prose strong { color: #d6619e; font-weight: 900; text-transform: uppercase; }
      `}</style>
    </div>
  );
}
