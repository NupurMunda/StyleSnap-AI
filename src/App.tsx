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
  Shield,
  Minus,
  Square,
  FileText,
  Search,
  AlertTriangle,
  LogIn,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Menu,
  ChevronDown,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';
import { 
  auth, 
  loginWithGoogle, 
  logout, 
  db, 
  rtdb 
} from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  ref, 
  onValue, 
  get, 
  child 
} from 'firebase/database';
import { 
  doc, 
  setDoc, 
  getDoc, 
  getDocFromServer,
  collection, 
  onSnapshot,
  query,
  where,
  deleteDoc
} from 'firebase/firestore';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

type Tab = 'ANALYSE' | 'RATE' | 'DEEP_DIVE' | 'SHOP' | 'WISHLIST';

interface Product {
  id: string;
  name: string;
  product_name?: string;
  productName?: string;
  title?: string;
  price: string;
  image_url: string;
  affiliate_link: string;
  kibbe_type: string;
  kitchener_essence: string;
  platform?: string;
  category?: string;
}

interface RateLimit {
  count: number;
  lastReset: number;
  isFirstTime: boolean;
  bonusScans: number;
}

const RESET_TIME = 24 * 60 * 60 * 1000; // 24 hours

type View = 'APP' | 'PRIVACY' | 'TERMS';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

/**
 * Centralized logic to resolve a meaningful product name from various potential database fields.
 */
const resolveProductName = (data: any): string => {
  if (!data) return 'Style Item';
  
  const candidates = [
    data.product_name,
    data.productName,
    data.product_title,
    data.item_name,
    data.title,
    data.name,
    data.label,
    data.display_name,
    data.product_label
  ];
  
  const isGeneric = (n: any) => 
    !n || 
    typeof n !== 'string' || 
    n.toLowerCase().includes('style item') || 
    n.toLowerCase().includes('unknown') ||
    n.toLowerCase() === 'newme' ||
    n.toLowerCase() === 'savana';
  
  // 1. Try to find the first non-generic name
  for (const candidate of candidates) {
    if (!isGeneric(candidate)) return candidate;
  }
  
  // 2. Fallback to URL parsing if all candidates are generic
  const link = data.affiliate_link || data.product_url;
  if (link) {
    try {
      const url = new URL(link);
      const pathParts = url.pathname.split('/').filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && lastPart.length > 3) {
        // Clean up common URL suffixes like .html or query params
        const cleanName = lastPart.split('.')[0].split('?')[0];
        return cleanName.split(/[\-\_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    } catch (e) {}
  }
  
  // 3. Final fallback: find ANY non-empty string among candidates
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  
  return 'Style Item';
};

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const inferCategory = (name: string | undefined | null) => {
  if (!name) return 'UNCATEGORIZED';
  const n = name.toLowerCase();
  if (n.includes('dress')) return 'DRESSES';
  if (n.includes('top') || n.includes('shirt') || n.includes('blouse') || n.includes('tee') || n.includes('tank')) return 'TOPS';
  if (n.includes('pant') || n.includes('jean') || n.includes('trouser') || n.includes('skirt') || n.includes('short') || n.includes('bottom')) return 'BOTTOMS';
  if (n.includes('set') || n.includes('coord') || n.includes('suit')) return 'SETS';
  if (n.includes('accessory') || n.includes('bag') || n.includes('jewelry') || n.includes('belt') || n.includes('earring') || n.includes('necklace')) return 'ACCESSORIES';
  return 'UNCATEGORIZED';
};

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('ANALYSE');
  const [currentView, setCurrentView] = useState<View>('APP');
  const [showCookieConsent, setShowCookieConsent] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // Results
  const [identityResult, setIdentityResult] = useState<{ [key: string]: string } | null>(null);
  const [rateResult, setRateResult] = useState<string | null>(null);
  const [deepDiveResult, setDeepDiveResult] = useState<string | null>(null);
  const [showOverload, setShowOverload] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [showQuotaError, setShowQuotaError] = useState(false);

  // Photos
  const [idPhotos, setIdPhotos] = useState<(string | null)[]>([null, null]);
  const [lookPhoto, setLookPhoto] = useState<string | null>(null);

  // Shop & Wishlist
  const [products, setProducts] = useState<Product[]>([]);
  const [currentProductIndex, setCurrentProductIndex] = useState(0);
  const [wishlist, setWishlist] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [sharedWishlist, setSharedWishlist] = useState<Product[]>([]);
  const [sharedUserId, setSharedUserId] = useState<string | null>(null);
  const [isSharedView, setIsSharedView] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (currentUser) {
        // Load user data from Firestore
        const userDocRef = doc(db, 'users', currentUser.uid);
        onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.identityResult) setIdentityResult(data.identityResult);
            if (data.deepDiveResult) setDeepDiveResult(data.deepDiveResult);
            if (data.preferences) setPreferences(data.preferences);
            if (data.idPhotos) setIdPhotos(data.idPhotos);
            // lookPhoto is NOT loaded from Firestore to keep it out of persistent memory
          }
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, 'users/' + currentUser.uid);
        });

        // Load wishlist from Firestore
        const wishlistRef = collection(db, 'users', currentUser.uid, 'wishlist');
        onSnapshot(wishlistRef, (querySnapshot) => {
          const items: Product[] = [];
          querySnapshot.forEach((doc) => {
            const data = doc.data();
            // Only show items that have an affiliate link
            if (data.affiliate_link) {
              const finalName = resolveProductName(data);

              items.push({ 
                id: doc.id, 
                ...data,
                name: finalName,
                affiliate_link: data.affiliate_link
              } as Product);
            }
          });
          setWishlist(items);
        }, (error) => {
          handleFirestoreError(error, OperationType.LIST, 'users/' + currentUser.uid + '/wishlist');
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Check for shared wishlist in URL or manual path routing
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/privacy') {
      setCurrentView('PRIVACY');
      return;
    }
    if (path === '/terms') {
      setCurrentView('TERMS');
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const sharedUid = params.get('wishlist');
    if (sharedUid) {
      setSharedUserId(sharedUid);
      setIsSharedView(true);
      setActiveTab('WISHLIST');
      
      // Load shared wishlist
      const wishlistRef = collection(db, 'users', sharedUid, 'wishlist');
      onSnapshot(wishlistRef, (querySnapshot) => {
        const items: Product[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.affiliate_link) {
            const finalName = resolveProductName(data);
            items.push({ 
              id: doc.id, 
              ...data,
              name: finalName,
              affiliate_link: data.affiliate_link
            } as Product);
          }
        });
        setSharedWishlist(items);
      }, (error) => {
        console.error('Error loading shared wishlist:', error);
        setError('Could not load shared wishlist. It might be private or the link is invalid.');
      });
    }
  }, []);

  // Fetch Products when identity is available
  useEffect(() => {
    if (identityResult && (activeTab === 'SHOP')) {
      fetchProducts();
    }
  }, [identityResult, activeTab]);

  // Remove products from Shop if they are wishlisted in real-time
  useEffect(() => {
    if (products.length > 0 && wishlist.length > 0) {
      const filtered = products.filter(p => !wishlist.some(w => w.id === p.id));
      if (filtered.length !== products.length) {
        setProducts(filtered);
        // Ensure index is still valid
        if (currentProductIndex >= filtered.length && filtered.length > 0) {
          setCurrentProductIndex(0);
        }
      }
    }
  }, [wishlist, products.length, currentProductIndex]);

  const fetchProducts = async () => {
    setLoadingProducts(true);
    setError(null);
    const productsRef = ref(rtdb, 'products'); // Fetch all platforms (newme, savana, etc.)
    try {
      const snapshot = await get(productsRef);
      if (snapshot.exists()) {
        const allProducts: any[] = [];
        
        // Iterate through platforms (e.g., 'newme', 'savana')
        snapshot.forEach((platformSnapshot) => {
          const platformName = platformSnapshot.key || 'Unknown';
          const platformData = platformSnapshot.val();
          
          // Support both flat structure (products/newme/prod1) 
          // and nested structure (products/newme/products/prod1)
          const productsSource = (platformData && platformData.products && typeof platformData.products === 'object') 
            ? platformSnapshot.child('products') 
            : platformSnapshot;
          
          productsSource.forEach((childSnapshot) => {
            const val = childSnapshot.val();
            if (val && typeof val === 'object' && (val.affiliate_link || val.product_url)) {
              const productName = resolveProductName(val);
              
              const productData = {
                id: childSnapshot.key,
                ...val,
                platform: platformName,
                name: productName,
                affiliate_link: val.affiliate_link || val.product_url
              };
              allProducts.push(productData);
            }
          });
        });

        // Smart Tokenized Filter
        const filtered = allProducts.filter(p => {
          const userKibbe = (identityResult?.['BODY TYPE'] || '').toLowerCase();
          const userEssence = (identityResult?.['ESSENCE'] || '').toLowerCase();
          
          const pKibbe = String(p.kibbe_type || '').toLowerCase();
          const pEssence = String(p.kitchener_essence || '').toLowerCase();

          // Helper to break strings into searchable tokens (words)
          const tokenize = (str: string) => 
            str.split(/[\s\-\,\(\)\/]+/).filter(t => t.length > 2);
          
          const uKibbeTokens = tokenize(userKibbe);
          const uEssenceTokens = tokenize(userEssence);
          const pKibbeTokens = tokenize(pKibbe);
          const pEssenceTokens = tokenize(pEssence);

          // If no type/essence defined on product, don't show it
          if (pKibbeTokens.length === 0 && pEssenceTokens.length === 0) return false;

          // Exclude if already in wishlist
          const isWishlisted = wishlist.some(w => w.id === p.id);
          if (isWishlisted) return false;

          // Match if any product token exists in the user's analyzed tokens
          const hasKibbeMatch = pKibbeTokens.some(t => uKibbeTokens.includes(t));
          const hasEssenceMatch = pEssenceTokens.some(t => uEssenceTokens.includes(t));

          return hasKibbeMatch || hasEssenceMatch;
        });

        // Randomize the order
        const shuffled = [...filtered].sort(() => Math.random() - 0.5);

        setProducts(shuffled);
        setCurrentProductIndex(0);
      } else {
        setProducts([]);
      }
    } catch (err: any) {
      console.error("Style Engine Error (RTDB):", err);
      setError("Ugh, the Shop Engine is glitching! " + (err.message || "Unknown error"));
    } finally {
      setLoadingProducts(false);
    }
  };

  const addToWishlist = async (product: Product) => {
    if (!user) {
      setError("Babe! You need to login to save items to your wishlist! 💖✨");
      return;
    }
    try {
      const wishlistDocRef = doc(db, 'users', user.uid, 'wishlist', product.id);
      const name = resolveProductName(product);
      const affiliate_link = product.affiliate_link;
      
      if (!affiliate_link) {
        console.warn('Attempted to add item to wishlist without affiliate_link:', product.id);
        // We could return here, but since we filter them out in the UI, this shouldn't happen.
      }
      
      const { id, price, image_url, kibbe_type, kitchener_essence, platform, category } = product;
      const categoryToSave = category || inferCategory(name);
      const cleanProduct = { id, name, price, image_url, affiliate_link, kibbe_type, kitchener_essence, platform, category: categoryToSave };
      
      // Remove undefined fields
      Object.keys(cleanProduct).forEach(key => {
        if ((cleanProduct as any)[key] === undefined) {
          delete (cleanProduct as any)[key];
        }
      });

      await setDoc(wishlistDocRef, cleanProduct);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'users/' + user.uid + '/wishlist/' + product.id);
    }
  };

  const removeFromWishlist = async (productId: string) => {
    if (!user) return;
    try {
      const wishlistDocRef = doc(db, 'users', user.uid, 'wishlist', productId);
      await deleteDoc(wishlistDocRef);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, 'users/' + user.uid + '/wishlist/' + productId);
    }
  };

  const handleShareWishlist = async () => {
    if (!user) return;
    setSharing(true);
    try {
      const shareUrl = `${window.location.origin}${window.location.pathname}?wishlist=${user.uid}`;
      
      if (navigator.share) {
        await navigator.share({
          title: 'My StyleSnap Wishlist 💖',
          text: 'Check out my iconic style wishlist! ✨',
          url: shareUrl
        });
        grantBonusScan();
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setSuccessMessage('Wishlist link copied to clipboard! 💖✨');
        setTimeout(() => setSuccessMessage(null), 3000);
        // Still grant bonus scan for copying if navigator.share is not available
        grantBonusScan();
      }
    } catch (err) {
      console.error('Failed to share wishlist:', err);
    } finally {
      setSharing(false);
    }
  };

  const grantBonusScan = () => {
    const limit = getRateLimit();
    limit.bonusScans = (limit.bonusScans || 0) + 1;
    localStorage.setItem('stylesnap_v4_limit', JSON.stringify(limit));
    setSuccessMessage('Bonus scan unlocked! 🚀✨');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleSwipe = (direction: 'left' | 'right') => {
    if (direction === 'right') {
      addToWishlist(products[currentProductIndex]);
    }
    setCurrentProductIndex(prev => (prev + 1) % products.length);
  };

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ type: 'ID' | 'LOOK', index?: number } | null>(null);

  // Load state from localStorage
  useEffect(() => {
    // Test Firestore connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        console.log("Firestore connection successful! 💖");
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
      }
    };
    testConnection();

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
      // lookPhoto is NOT loaded from localStorage to keep it out of persistent memory
    }
  }, []);

  // Save state to Firestore or localStorage
  const saveAppState = async (prefs: string, idRes: any, ddRes: any, photos: any) => {
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, {
          identityResult: idRes,
          deepDiveResult: ddRes,
          preferences: prefs,
          idPhotos: photos.idPhotos,
          // lookPhoto and rateResult are NOT saved to persistent storage
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, 'users/' + user.uid);
      }
    } else {
      // Fallback to localStorage for guests
      try {
        localStorage.setItem('userPrefs', prefs);
        if (idRes || ddRes) {
          localStorage.setItem('analysisResult', JSON.stringify({ identityResult: idRes, deepDiveResult: ddRes }));
        }
        // Save only ID photos, not lookPhoto
        localStorage.setItem('stylesnap_photos', JSON.stringify({ idPhotos: photos.idPhotos }));
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          localStorage.removeItem('stylesnap_photos');
          localStorage.removeItem('analysisResult');
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
    setLookPhoto(null);
    setRateResult(null);
    setShowQuotaError(false);
  };

  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent');
    if (!consent) {
      setShowCookieConsent(true);
    }
  }, []);

  const handleAcceptCookies = () => {
    localStorage.setItem('cookie-consent', 'true');
    setShowCookieConsent(false);
  };

  const getRateLimit = (): RateLimit => {
    const saved = localStorage.getItem('stylesnap_v4_limit');
    if (saved) {
      const limit: RateLimit = JSON.parse(saved);
      if (Date.now() - limit.lastReset > RESET_TIME) {
        // Reset count but keep isFirstTime status (it becomes false after first day)
        return { 
          count: 0, 
          lastReset: Date.now(), 
          isFirstTime: false, 
          bonusScans: limit.bonusScans || 0 
        };
      }
      return limit;
    }
    // Initial state for brand new user
    return { count: 0, lastReset: Date.now(), isFirstTime: true, bonusScans: 0 };
  };

  const getEffectiveLimit = (limit: RateLimit) => {
    const baseLimit = limit.isFirstTime ? 3 : 1;
    return baseLimit + (limit.bonusScans || 0);
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
        console.log("Image loaded, starting compression...");
        const rawBase64 = reader.result as string;
        const compressedBase64 = await compressImage(rawBase64);
        console.log("Compression complete.");
        
        if (uploadTarget.type === 'ID' && uploadTarget.index !== undefined) {
          const newPhotos = [...idPhotos];
          newPhotos[uploadTarget.index] = compressedBase64;
          setIdPhotos(newPhotos);
          saveAppState(preferences, identityResult, deepDiveResult, { idPhotos: newPhotos, lookPhoto });
        } else if (uploadTarget.type === 'LOOK') {
          setLookPhoto(compressedBase64);
          setRateResult(null); // Clear old result for fresh analysis
          saveAppState(preferences, identityResult, deepDiveResult, { idPhotos, lookPhoto: compressedBase64 });
        }
        setUploadTarget(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerUpload = (type: 'ID' | 'LOOK', index?: number) => {
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
    if (limit.count >= getEffectiveLimit(limit)) {
      setShowOverload(true);
      return;
    }

    setAnalyzing(true);
    setError(null);
    console.log("Starting analysis with", photos.length, "photos...");

    try {
      const imageParts = photos.map(p => ({
        inlineData: {
          data: p!.split(',')[1],
          mimeType: p!.split(';')[0].split(':')[1]
        }
      }));

      // Use a fresh instance to be safe
      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

      console.log("Requesting table and manual from Gemini (Flash)...");
      
      // Simultaneous generation of Table and Manual
      // Using Flash for speed as requested by user ("it's taking too long")
      const [tableResponse, manualResponse] = await Promise.all([
        genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          config: { 
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                "BODY TYPE": { type: "STRING" },
                "SEASON": { type: "STRING" },
                "ESSENCE": { type: "STRING" },
                "ROOTS": { type: "STRING" },
                "CELEB TWIN": { type: "STRING" }
              },
              required: ["BODY TYPE", "SEASON", "ESSENCE", "ROOTS", "CELEB TWIN"]
            }
          },
          contents: [{
            parts: [
              { text: `ROLE: You are the "StyleSnap AI Engine," a professional image consultant trained in the Kibbe body typing system, Kitchener essence system, and seasonal color analysis.

### PART 1 — KIBBE BODY TYPE IDENTIFICATION (THE LOGIC)
Evaluate the user's photos:
1. VERTICAL LINE: visual elongation.
2. BONE STRUCTURE: shoulders/limbs.
3. FLESH DISTRIBUTION: yin/yang balance.
4. FINAL FAMILY MAPPING.

### PART 2 — KITCHENER ESSENCE IDENTIFICATION
Analyze facial proportions from the face-up photo.

### PART 3 — SEASONAL COLOR ANALYSIS
Analyze Skin undertone, Depth, Contrast, and Chroma.

TASK: Analyze the user's style identity based on the photos and their preferences.
USER PREFERENCES: ${preferences}

### FIELD DEFINITIONS:
- BODY TYPE: The Kibbe body type (e.g., Soft Gamine, Dramatic Classic).
- SEASON: The seasonal color palette (e.g., Deep Autumn, Cool Summer).
- ESSENCE: The Kitchener essence blend (e.g., Ingenue-Romantic-Gamine).
- ROOTS: The core style elements and details that define this identity (e.g., ruffles, lace, broken lines, animated detail). DO NOT just repeat the user's preferences; translate them into professional style roots.
- CELEB TWIN: A famous person with a similar style identity.

OUTPUT FORMAT: Return a JSON object with the specified schema.` },
              ...imageParts
            ]
          }]
        }),
        genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [{
            parts: [
              { text: `ROLE: You are the "StyleSnap AI Engine," a professional image consultant. Your tone is "90s fashion expert."

TASK: Provide a detailed "Style Manual" based on the logic of Kibbe, Kitchener, and Seasonal Color Analysis.
CONSTRAINTS: Use BOLD PINK CAPS for all item recommendations and ICONIC swaps.

OUTPUT FORMAT:
### THE VERDICT
A deep-dive paragraph explaining the "why" behind their frame and essence.

### COLOR STORY
Why their palette works and specific ICONIC swaps in BOLD PINK CAPS.

### ACCESSORY UPGRADE
Suggest specific 90s details in BOLD PINK CAPS.

### EMPOWERMENT
"You are a total star! 💖✨"` },
              ...imageParts
            ]
          }]
        })
      ]);

      console.log("Gemini responded successfully.");

      const tableJson = JSON.parse(tableResponse.text || "{}");
      const manualText = manualResponse.text || "Oops! The manual failed to print! 🎀";
      
      setIdentityResult(tableJson);
      setDeepDiveResult(manualText);
      
      // Clear photos after analysis as requested (don't store them)
      const emptyPhotos = [null, null];
      setIdPhotos(emptyPhotos);
      
      saveAppState(preferences, tableJson, manualText, { idPhotos: emptyPhotos, lookPhoto });
      incrementLimit();
    } catch (err: any) {
      console.error("Analysis Error Details:", err);
      setError("Ugh, system crash! " + (err.message || "Unknown error"));
    } finally {
      setAnalyzing(false);
    }
  };

  const runRateMyLook = async () => {
    const limit = getRateLimit();
    const maxScans = getEffectiveLimit(limit);
    
    if (limit.count >= maxScans) {
      setShowOverload(true);
      return;
    }

    if (!lookPhoto) {
      setError("Babe, show me the look! Upload a photo of your outfit! 👗✨");
      return;
    }

    if (!identityResult) {
      setError("System Error! Run Identity Scan first! 💖");
      return;
    }

    setAnalyzing(true);
    setError(null);
    console.log("Starting Rate My Look...");

    try {
      const imagePart = {
        inlineData: {
          data: lookPhoto.split(',')[1],
          mimeType: lookPhoto.split(';')[0].split(':')[1]
        }
      };

      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
      console.log("Requesting rating from Gemini...");

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{
          parts: [
            { text: `ROLE: You are the "StyleSnap AI Engine," a professional 90s fashion expert and outfit coach.
            CONTEXT: The user's identity is: ${JSON.stringify(identityResult)}. 
            TASK: Grade this outfit and provide "Level Up" coaching.
            
            OUTPUT FORMAT:
            - MATCH SCORE: [X/10] 🌟
            - THE VIBE: 1-sentence description.
            - STYLE ENHANCEMENTS (The "Level Up"):
              * [Focus on Balance]
              * [Focus on Color]
              * [Focus on Detail]` },
            imagePart
          ]
        }]
      });

      console.log("Gemini responded to rating.");
      setRateResult(response.text || "System error! 💖");
      incrementLimit();
    } catch (err: any) {
      console.error("Rating Error:", err);
      setError("System glitch! " + (err.message || "Unknown error"));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleShareVerdict = async () => {
    if (!deepDiveResult) return;
    setSharing(true);
    try {
      const shareData = {
        title: 'My Style Verdict ✨',
        text: `Check out my personal style manual from StyleSnap AI! 💖\n\n${deepDiveResult.slice(0, 200)}...`,
        url: window.location.href
      };

      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(`${shareData.text}\n\nRead more at: ${shareData.url}`);
        alert('Verdict copied to clipboard! Share it with your friends! 💖✨');
      }
    } catch (err) {
      console.error('Share error:', err);
    } finally {
      setSharing(false);
    }
  };

  const runDeepDive = async () => {
    if (!identityResult) {
      setError("System Error! Run Identity Scan first! 💖");
      return;
    }

    setAnalyzing(true);
    setError(null);
    console.log("Starting Deep Dive...");

    try {
      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
      console.log("Requesting deep dive from Gemini...");

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{
          parts: [
            { text: `ROLE: 90s fashion expert. 
            TONE: High-energy, relatable, and educational. Use phrases like "OMG bestie", "literal [Season] queen", and "total style icon".
            CONTEXT: The user's identity is: ${JSON.stringify(identityResult)}. 
            TASK: Provide a detailed "Deep Dive" explanation of their style identity.
            CONSTRAINTS: 
            - Use BOLD PINK CAPS for all item recommendations and accessory upgrades.
            - Explain the "WHY" behind the recommendations (e.g., why certain lines work for their essence).
            - Use bullet points with emojis for lists of items.
            OUTPUT FORMAT:
            - THE VERDICT: A deep, educational paragraph explaining the harmony of their lines/essence.
            - COLOUR STORY: Explain why their Season works and suggest iconic color swaps.
            - STYLE MANUAL (ICONIC): A bulleted list of specific item upgrades in BOLD PINK CAPS, each with a relevant emoji.
            - EMPOWERMENT: End with: "You are a total star! 💖✨"` }
          ]
        }]
      });

      console.log("Gemini responded to deep dive.");
      setDeepDiveResult(response.text || "System error! 💖");
    } catch (err: any) {
      console.error("Deep Dive Error:", err);
      setError("System glitch! " + (err.message || "Unknown error"));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleLogin = async () => {
    if (loggingIn) return;
    setLoggingIn(true);
    setError(null);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      console.error("Login Error:", err);
      if (err.code === 'auth/popup-closed-by-user') {
        // User closed the popup, no need to show an error message
        return;
      }
      if (err.code === 'auth/operation-not-allowed') {
        setError("Babe! You need to enable Google Login in your Firebase Console! 🛑 Go to Auth > Sign-in method and turn on Google! ✨");
      } else {
        setError("Login failed! " + (err.message || "Unknown error"));
      }
    } finally {
      setLoggingIn(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      const limit = getRateLimit();
      const timeLeft = RESET_TIME - (Date.now() - limit.lastReset);
      if (timeLeft > 0) {
        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
        setCountdown(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
      } else {
        setCountdown('00:00:00');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="p-4 md:p-8 flex flex-col items-center min-h-screen">
      <AnimatePresence mode="wait">
        {currentView === 'PRIVACY' ? (
          <PrivacyPolicy key="privacy" onBack={() => setCurrentView('APP')} />
        ) : currentView === 'TERMS' ? (
          <TermsOfService key="terms" onBack={() => setCurrentView('APP')} />
        ) : (
          <motion.div 
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="w-full flex flex-col items-center"
          >
            {/* App Header */}
            <header className="sticky top-0 z-50 w-full bg-pastel-pink/95 backdrop-blur-md border-b-4 border-barbie-pink py-3 mb-8 shadow-md">
              <div className="w-full max-w-4xl mx-auto px-4 flex items-center justify-between gap-2">
                {/* Left side spacer for desktop centering */}
                <div className="w-24 hidden md:block" />

                {/* Center: Title & Version */}
                <div className="flex flex-col items-center flex-1 min-w-0">
                  <h1 className="text-2xl md:text-4xl font-black text-barbie-pink italic tracking-tighter drop-shadow-[2px_2px_0px_rgba(0,0,0,1)] leading-none truncate">
                    STYLESNAP AI
                  </h1>
                  <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-[0.4em] text-dark-blue/60 mt-1">
                    V4.0 • STYLE_ENGINE.EXE
                  </p>
                </div>

                {/* Right: User & Logout */}
                <div className="w-auto md:w-24 flex justify-end shrink-0">
                  {user && (
                    <div className="flex items-center gap-2">
                      <img 
                        src={user.photoURL || ''} 
                        className="w-6 h-6 rounded-full border-2 border-barbie-pink hidden sm:block" 
                        alt="User"
                        referrerPolicy="no-referrer"
                      />
                      <button 
                        onClick={logout} 
                        className="bg-white text-barbie-pink border-2 border-barbie-pink px-2 py-1 text-[8px] font-black uppercase tracking-tighter shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all flex items-center gap-1 h-6"
                      >
                        <LogOut size={10} /> <span className="hidden sm:inline">LOGOUT</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </header>

      {/* Main Window */}
      <div className="w-full max-w-4xl retro-window">
        {!isAuthReady ? (
          <div className="p-20 flex flex-col items-center justify-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-barbie-pink"></div>
            <p className="text-xs font-bold animate-pulse uppercase tracking-widest">BOOTING STYLE_ENGINE.EXE...</p>
          </div>
        ) : !user ? (
          <div className="p-12 md:p-20 flex flex-col items-center justify-center text-center gap-8">
            <div className="w-24 h-24 bg-barbie-pink/10 rounded-full flex items-center justify-center border-2 border-barbie-pink animate-bounce shadow-[0_0_20px_rgba(255,105,180,0.3)]">
              <Sparkles size={48} className="text-barbie-pink" />
            </div>
            <div className="max-w-md">
              <h2 className="text-3xl font-black text-dark-blue mb-4 tracking-tighter uppercase italic">GET YOUR ULTIMATE GLOW-UP</h2>
              <p className="text-sm font-medium text-gray-600 leading-relaxed">
                Level up your fashion sense.<br />
                Get your free personal style assessment and color analysis in seconds. ✨
              </p>
            </div>
            <button 
              onClick={handleLogin} 
              disabled={loggingIn}
              className="retro-button px-10 py-4 text-lg flex items-center gap-3 group hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loggingIn ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent" />
                  LOADING...
                </>
              ) : (
                <>
                  <LogIn className="group-hover:rotate-12 transition-transform" />
                  LOGIN WITH GOOGLE
                </>
              )}
            </button>
            <div className="flex flex-col items-center gap-1">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                Secure Auth via Firebase • Style Engine v4.0
              </p>
              <p className="text-[8px] text-gray-300 uppercase tracking-widest">
                All your data is synced across devices ☁️
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Title Bar */}
            <div className="retro-title-bar">
              <div className="flex items-center gap-2">
                <Sparkles size={14} />
                <span>StyleSnap_Engine.exe</span>
              </div>
              <div className="flex gap-1">
                <div className="w-4 h-4 bg-retro-grey border border-gray-600 flex items-center justify-center text-black text-[10px]"><Minus size={10}/></div>
                <div className="w-4 h-4 bg-retro-grey border border-gray-600 flex items-center justify-center text-black text-[10px]"><Square size={8}/></div>
                <div className="w-4 h-4 bg-retro-grey border border-gray-600 flex items-center justify-center text-black text-[10px]"><X size={10}/></div>
              </div>
            </div>

        {/* Tabs - Desktop */}
        <div className="hidden md:flex px-2 pt-2 gap-1 bg-retro-grey border-b-2 border-gray-600">
          <button 
            onClick={() => setActiveTab('ANALYSE')}
            className={`retro-tab ${activeTab === 'ANALYSE' ? 'retro-tab-active' : ''}`}
          >
            {identityResult ? '[MY_IDENTITY.EXE]' : '[ANALYSE_ME.EXE]'}
          </button>
          <button 
            onClick={() => setActiveTab('RATE')}
            className={`retro-tab ${activeTab === 'RATE' ? 'retro-tab-active' : ''}`}
          >
            [RATE_MY_LOOK.EXE]
          </button>
          <button 
            onClick={() => setActiveTab('DEEP_DIVE')}
            className={`retro-tab ${activeTab === 'DEEP_DIVE' ? 'retro-tab-active' : ''}`}
          >
            [DEEP_DIVE.DOC]
          </button>
          <button 
            onClick={() => setActiveTab('SHOP')}
            className={`retro-tab ${activeTab === 'SHOP' ? 'retro-tab-active' : ''}`}
          >
            [SHOP.EXE]
          </button>
          <button 
            onClick={() => setActiveTab('WISHLIST')}
            className={`retro-tab ${activeTab === 'WISHLIST' ? 'retro-tab-active' : ''}`}
          >
            [WISHLIST.EXE]
          </button>
        </div>

        {/* Tabs - Mobile Hamburger */}
        <div className="md:hidden bg-retro-grey border-b-2 border-gray-600 relative">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="w-full p-3 flex items-center justify-between font-bold text-dark-blue"
          >
            <div className="flex items-center gap-2">
              <Menu size={18} />
              <span>[{activeTab}_MODE]</span>
            </div>
            <ChevronDown size={18} className={`transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-t border-gray-400 bg-white"
              >
                {[
                  { id: 'ANALYSE', label: 'ANALYSE_ME.EXE' },
                  { id: 'RATE', label: 'RATE_MY_LOOK.EXE' },
                  { id: 'DEEP_DIVE', label: 'DEEP_DIVE.DOC' },
                  { id: 'SHOP', label: 'SHOP.EXE' },
                  { id: 'WISHLIST', label: 'WISHLIST.EXE' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id as Tab);
                      setIsMenuOpen(false);
                    }}
                    className={`w-full p-4 text-left font-bold border-b border-gray-100 flex items-center justify-between ${activeTab === tab.id ? 'text-barbie-pink bg-pink-50' : 'text-dark-blue'}`}
                  >
                    <span>[{tab.label}]</span>
                    {activeTab === tab.id && <Sparkles size={14} />}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
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
                                  saveAppState(preferences, identityResult, deepDiveResult, { idPhotos: next, lookPhoto });
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
                          saveAppState(e.target.value, identityResult, deepDiveResult, { idPhotos, lookPhoto });
                        }}
                        placeholder="Tell me your vibe (e.g., Coquette, Dark Academia, Corporate Chic)..."
                        className="w-full retro-inset h-20 text-sm focus:outline-none resize-none"
                      />
                    </div>

                    <div className="flex flex-col items-center gap-4">
                      <p className="text-[9px] font-bold text-gray-500 mb-1 uppercase tracking-tighter">[PROTECT_MODE]: SCANS ARE VOLATILE & AUTO-DELETED AFTER ANALYSIS.</p>
                      <button 
                        onClick={runAnalyseMe}
                        disabled={analyzing || idPhotos.some(p => !p) || getRateLimit().count >= getEffectiveLimit(getRateLimit())}
                        className="retro-button w-full max-w-xs flex items-center justify-center gap-2"
                      >
                        {analyzing ? (
                          <>
                            <RefreshCw className="animate-spin" size={18} />
                            <span className="animate-pulse">ANALYZING...</span>
                          </>
                        ) : (
                          <>
                            <Zap size={18} />
                            <span>SCAN MY STYLE!</span>
                          </>
                        )}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center w-full space-y-6">
                    <div className="text-center">
                      <h2 className="text-xl font-bold text-dark-blue italic uppercase tracking-tighter">✨ YOUR STYLE IDENTITY ✨</h2>
                      <p className="text-[10px] text-gray-500 font-bold uppercase">Analysis complete • Style Engine v4.0</p>
                    </div>

                    <div className="retro-inset w-full bg-white">
                      <div className="flex flex-col">
                        {Object.entries(identityResult).map(([label, value]) => (
                          <div key={label} className="retro-row px-2">
                            <span className="retro-row-label">{label}</span>
                            <span className="retro-row-value whitespace-pre-wrap">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-4 w-full">
                      <button 
                        onClick={() => {
                          setIdentityResult(null);
                          setDeepDiveResult(null);
                          setIdPhotos([null, null]);
                          saveAppState(preferences, null, null, { idPhotos: [null, null], lookPhoto });
                        }}
                        className="retro-button w-full max-w-xs flex items-center justify-center gap-2"
                      >
                        <RefreshCw size={18} />
                        <span>ANALYSE AGAIN! ✨</span>
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'RATE' && (
              <motion.div 
                key="rate"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="text-center mb-4">
                  <h2 className="text-xl font-bold text-dark-blue italic">👗 RATE_MY_LOOK.EXE 👗</h2>
                  <p className="text-xs text-gray-600">High-energy outfit grading and coaching! 🌟</p>
                </div>

                {!identityResult ? (
                  <div className="retro-inset bg-red-50 border-red-200 text-red-600 text-center py-8">
                    <AlertTriangle className="mx-auto mb-2" />
                    <p className="font-bold">System Error! Run Identity Scan first! 💖</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-6">
                    {!rateResult ? (
                      /* State 1: Empty/Input */
                      <>
                        <div className="retro-inset w-full max-w-sm aspect-[4/3] flex flex-col items-center justify-center relative overflow-hidden group">
                          {lookPhoto ? (
                            <>
                              <img src={lookPhoto} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              <button 
                                onClick={() => {
                                  setLookPhoto(null);
                                  setRateResult(null);
                                }}
                                className="absolute top-2 right-2 p-1 bg-white/80 text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : (
                            <button 
                              onClick={() => triggerUpload('LOOK')}
                              className="flex flex-col items-center gap-2 text-gray-400 hover:text-barbie-pink transition-colors"
                            >
                              <Zap size={48} />
                              <span className="text-[10px] font-bold uppercase">Upload Outfit Photo</span>
                            </button>
                          )}
                        </div>

                        <button 
                          onClick={runRateMyLook}
                          disabled={analyzing || !lookPhoto || getRateLimit().count >= getEffectiveLimit(getRateLimit())}
                          className="retro-button w-full max-w-xs flex items-center justify-center gap-2"
                        >
                          {analyzing ? (
                            <>
                              <RefreshCw className="animate-spin" size={18} />
                              <span className="animate-pulse">GRADING...</span>
                            </>
                          ) : (
                            <>
                              <Search size={18} />
                              <span>SCAN MY LOOK!</span>
                            </>
                          )}
                        </button>
                      </>
                    ) : (
                      /* State 2: Result */
                      <>
                        <div className="retro-inset w-full max-w-sm aspect-[4/3] overflow-hidden">
                          <img src={lookPhoto!} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </div>

                        <div className="retro-inset w-full bg-white">
                          <div className="prose prose-sm prose-pink max-w-none">
                            <ReactMarkdown>
                              {rateResult}
                            </ReactMarkdown>
                          </div>
                        </div>

                        <button 
                          onClick={() => {
                            setLookPhoto(null);
                            setRateResult(null);
                          }}
                          className="retro-button w-full max-w-xs flex items-center justify-center gap-2"
                        >
                          <RefreshCw size={18} />
                          TRY ANOTHER LOOK!
                        </button>
                      </>
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
                        {analyzing ? (
                          <>
                            <RefreshCw className="animate-spin" size={18} />
                            <span className="animate-pulse">DIVING DEEP...</span>
                          </>
                        ) : (
                          <>
                            <FileText size={18} />
                            <span>GENERATE MY MANUAL!</span>
                          </>
                        )}
                      </button>
                    )}

                    {deepDiveResult && (
                      <div className="flex flex-col items-center gap-6 w-full">
                        <div className="retro-inset w-full bg-white max-h-[500px] overflow-auto">
                          <div className="prose prose-sm prose-pink max-w-none deep-dive-content">
                            <ReactMarkdown 
                              components={{
                                strong: ({node, ...props}) => <span className="bold-pink-caps" {...props} />,
                                li: ({node, ...props}) => <li className="mb-2 list-none" {...props} />
                              }}
                            >
                              {deepDiveResult}
                            </ReactMarkdown>
                          </div>
                        </div>
                        
                        <button 
                          onClick={handleShareVerdict}
                          disabled={sharing}
                          className="retro-button w-full max-w-xs flex items-center justify-center gap-2"
                        >
                          {sharing ? (
                            <RefreshCw className="animate-spin" size={18} />
                          ) : (
                            <Share2 size={18} />
                          )}
                          <span>SHARE MY VERDICT! ✨</span>
                        </button>
                      </div>
                    )}
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
                  <h2 className="text-xl font-bold text-dark-blue italic">🛍️ SHOP.EXE 🛍️</h2>
                  <p className="text-xs text-gray-600">Curated styles for your unique vibe! ✨</p>
                </div>

                {!user ? (
                  <div className="retro-inset bg-blue-50 border-blue-200 text-blue-600 text-center py-12 space-y-4">
                    <LogIn className="mx-auto" size={48} />
                    <p className="font-bold">Login to start shopping your vibe, babe! 💖</p>
                    <button 
                      onClick={handleLogin} 
                      disabled={loggingIn}
                      className="retro-button px-8 disabled:opacity-50"
                    >
                      {loggingIn ? 'WAIT...' : 'LOGIN NOW'}
                    </button>
                  </div>
                ) : !identityResult ? (
                  <div className="retro-inset bg-red-50 border-red-200 text-red-600 text-center py-8">
                    <AlertTriangle className="mx-auto mb-2" />
                    <p className="font-bold">System Error! Run Identity Scan first! 💖</p>
                  </div>
                ) : loadingProducts ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="animate-spin text-barbie-pink mb-4" size={48} />
                    <p className="text-sm font-bold text-dark-blue animate-pulse">LOADING ICONIC STYLES...</p>
                  </div>
                ) : products.length > 0 ? (
                  <div className="flex flex-col items-center gap-8">
                    <div className="relative w-full max-w-sm aspect-[3/4] retro-window overflow-hidden group">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={products[currentProductIndex].id}
                          initial={{ x: 300, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          exit={{ x: -300, opacity: 0 }}
                          className="absolute inset-0 p-4 flex flex-col"
                        >
                          <a 
                            href={products[currentProductIndex].affiliate_link || `https://newme.asia/product/${products[currentProductIndex].id}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex flex-col h-full group/card cursor-pointer relative z-0"
                            onClick={(e) => {
                              console.log('Shop item clicked:', products[currentProductIndex]);
                              if (!products[currentProductIndex].affiliate_link) {
                                console.warn('Missing affiliate_link property on product object. Using fallback URL.');
                              }
                            }}
                          >
                            <div className="flex-1 retro-inset overflow-hidden mb-4 relative">
                              <img 
                                src={products[currentProductIndex].image_url} 
                                className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-110"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover/card:bg-black/10 transition-colors flex items-center justify-center">
                                <ExternalLink className="text-white opacity-0 group-hover/card:opacity-100 transition-opacity" size={32} />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <h3 className="text-lg font-black text-dark-blue uppercase leading-tight truncate group-hover/card:text-barbie-pink transition-colors">
                                {products[currentProductIndex].name}
                              </h3>
                              <div className="flex justify-between items-center">
                                <span className="text-barbie-pink font-bold text-xl">
                                  ₹{products[currentProductIndex].price}
                                </span>
                                <span className="text-[10px] font-bold text-gray-500 uppercase">
                                  {products[currentProductIndex].platform || 'NEWME'}
                                </span>
                              </div>
                            </div>
                          </a>
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    <div className="flex gap-6 w-full max-w-sm">
                      <button 
                        onClick={() => handleSwipe('left')}
                        className="retro-button flex-1 bg-red-100 hover:bg-red-200 border-red-400 flex items-center justify-center gap-2 py-4"
                      >
                        <X size={24} className="text-red-600" />
                        <span className="font-bold text-red-600">SKIP</span>
                      </button>
                      <button 
                        onClick={() => handleSwipe('right')}
                        className="retro-button flex-1 bg-green-100 hover:bg-green-200 border-green-400 flex items-center justify-center gap-2 py-4"
                      >
                        <Heart size={24} className="text-green-600" />
                        <span className="font-bold text-green-600">LOVE</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="retro-inset text-center py-12 space-y-4">
                    <ShoppingBag className="mx-auto text-gray-300" size={64} />
                    <p className="text-sm font-bold text-gray-500">Ugh, no styles found for your vibe yet! 🛑✨</p>
                    <button onClick={fetchProducts} className="text-xs text-barbie-pink underline font-bold">RETRY SCAN</button>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'WISHLIST' && (
              <motion.div 
                key="wishlist"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="text-center mb-4 relative">
                  <h2 className="text-xl font-bold text-dark-blue italic px-12">
                    {isSharedView ? '✨ SHARED_WISHLIST.EXE ✨' : '💖 WISHLIST.EXE 💖'}
                  </h2>
                  <p className="text-xs text-gray-600 px-12">
                    {isSharedView ? 'Viewing a curated collection! ✨' : 'Your collection of iconic looks! ✨'}
                  </p>
                  
                  {!isSharedView && user && wishlist.length > 0 && (
                    <button 
                      onClick={handleShareWishlist}
                      disabled={sharing}
                      className="absolute top-0 right-0 retro-button p-2 flex items-center justify-center"
                      title={sharing ? 'SHARING...' : 'SHARE'}
                    >
                      <Share2 size={14} className={sharing ? 'animate-spin' : ''} />
                    </button>
                  )}
                  
                  {isSharedView && (
                    <button 
                      onClick={() => {
                        setIsSharedView(false);
                        setSharedUserId(null);
                        setSharedWishlist([]);
                        window.history.pushState({}, '', window.location.pathname);
                      }}
                      className="absolute top-0 left-0 retro-button p-2 flex items-center gap-2 text-[10px]"
                    >
                      <X size={14} />
                      BACK
                    </button>
                  )}
                </div>

                {isSharedView ? (
                  sharedWishlist.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {sharedWishlist.map((item) => (
                        <div key={item.id} className="retro-window p-2 flex flex-col group relative">
                          <a 
                            href={item.affiliate_link || `https://newme.asia/product/${item.id}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex flex-col h-full group/item cursor-pointer relative z-0"
                          >
                            <div className="aspect-[3/4] retro-inset overflow-hidden mb-2 relative">
                              <img 
                                src={item.image_url} 
                                className="w-full h-full object-cover transition-transform duration-300 group-hover/item:scale-110"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover/item:bg-black/10 transition-colors flex items-center justify-center">
                                <ExternalLink className="text-white opacity-0 group-hover/item:opacity-100 transition-opacity" size={16} />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-black text-dark-blue uppercase truncate mb-1 group-hover/item:text-barbie-pink transition-colors">
                                {item.name}
                              </h4>
                              <div className="flex justify-between items-center">
                                <span className="text-barbie-pink font-bold text-xs">₹{item.price}</span>
                                <ExternalLink size={12} className="text-dark-blue" />
                              </div>
                            </div>
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="retro-inset text-center py-12 space-y-4">
                      <ShoppingBag className="mx-auto text-gray-300" size={64} />
                      <p className="text-sm font-bold text-gray-500">This shared wishlist is empty! 🛑✨</p>
                    </div>
                  )
                ) : (
                  !user ? (
                    <div className="retro-inset bg-blue-50 border-blue-200 text-blue-600 text-center py-12 space-y-4">
                      <LogIn className="mx-auto" size={48} />
                      <p className="font-bold">Login to see your saved styles, babe! 💖</p>
                      <button 
                        onClick={handleLogin} 
                        disabled={loggingIn}
                        className="retro-button px-8 disabled:opacity-50"
                      >
                        {loggingIn ? 'WAIT...' : 'LOGIN NOW'}
                      </button>
                    </div>
                  ) : wishlist.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {wishlist.map((item) => (
                        <div key={item.id} className="retro-window p-2 flex flex-col group relative">
                          <a 
                            href={item.affiliate_link || `https://newme.asia/product/${item.id}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex flex-col h-full group/item cursor-pointer relative z-0"
                            onClick={(e) => {
                              console.log('Wishlist item clicked:', item);
                              if (!item.affiliate_link) {
                                console.warn('Missing affiliate_link property on wishlist item. Using fallback URL.');
                              }
                            }}
                          >
                            <div className="aspect-[3/4] retro-inset overflow-hidden mb-2 relative">
                              <img 
                                src={item.image_url} 
                                className="w-full h-full object-cover transition-transform duration-300 group-hover/item:scale-110"
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover/item:bg-black/10 transition-colors flex items-center justify-center">
                                <ExternalLink className="text-white opacity-0 group-hover/item:opacity-100 transition-opacity" size={16} />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-black text-dark-blue uppercase truncate mb-1 group-hover/item:text-barbie-pink transition-colors">
                                {item.name}
                              </h4>
                              <div className="flex justify-between items-center">
                                <span className="text-barbie-pink font-bold text-xs">₹{item.price}</span>
                                <ExternalLink size={12} className="text-dark-blue" />
                              </div>
                            </div>
                          </a>
                          <button 
                            onClick={(e) => {
                              console.log('Remove from wishlist clicked for item:', item.id);
                              e.preventDefault();
                              e.stopPropagation();
                              removeFromWishlist(item.id);
                            }}
                            className="absolute top-1 right-1 p-1.5 bg-white/90 text-red-500 rounded-full shadow-md md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10 md:pointer-events-none md:group-hover:pointer-events-auto border border-red-100"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="retro-inset text-center py-12 space-y-4">
                      <Heart className="mx-auto text-gray-300" size={64} />
                      <p className="text-sm font-bold text-gray-500">Your wishlist is empty! Let's find some looks! 🛍️✨</p>
                      <button onClick={() => setActiveTab('SHOP')} className="retro-button px-8">GO TO SHOP</button>
                    </div>
                  )
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
            <span>SCANS: {getRateLimit().count}/{getEffectiveLimit(getRateLimit())}</span>
            <span className="animate-pulse text-green-600">SYSTEM_READY</span>
            <button 
              onClick={clearAllData}
              className="hover:text-red-500 transition-colors flex items-center gap-1 border-l border-gray-400 pl-4"
            >
              <Trash2 size={10} />
              CLEAR_DATA
            </button>
          </div>
          <div className="opacity-50">
            {/* Right side spacer */}
          </div>
        </div>
      </>
    )}
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
            <p className="text-[10px] text-gray-500">Use code: STYLE99 at checkout. ✨</p>
          </div>
        </div>
      </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cookie Consent */}
      <AnimatePresence>
        {showCookieConsent && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-4 left-4 right-4 z-[100] md:left-auto md:right-4 md:w-96"
          >
            <div className="retro-window bg-white p-6 shadow-2xl border-4 border-barbie-pink">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="text-barbie-pink" size={20} />
                <span className="font-black text-dark-blue italic uppercase tracking-tighter">COOKIE_CONSENT.EXE</span>
              </div>
              <p className="text-xs text-gray-600 font-medium leading-relaxed mb-4">
                We use cookies to make your style experience iconic! By clicking "ACCEPT", you agree to our use of cookies for analytics and personalized ads. ✨
              </p>
              <div className="flex gap-2">
                <button 
                  onClick={() => setCurrentView('PRIVACY')}
                  className="text-[10px] font-bold text-gray-400 uppercase hover:text-barbie-pink transition-colors"
                >
                  LEARN MORE
                </button>
                <button 
                  onClick={handleAcceptCookies}
                  className="retro-button flex-1 py-2 text-xs font-black"
                >
                  ACCEPT ALL
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                  <span>[❗] SYSTEM ALERT: RATE_ENGINE OVERHEATED</span>
                </div>
                <button onClick={() => setShowOverload(false)} className="w-4 h-4 bg-retro-grey border border-gray-600 flex items-center justify-center text-black text-[10px]"><X size={10}/></button>
              </div>
              <div className="p-8 bg-retro-grey text-center space-y-6">
                <div className="text-red-600 flex justify-center">
                  <AlertTriangle size={48} />
                </div>
                <h3 className="text-xl font-bold text-dark-blue uppercase tracking-tight">OMG Bestie, you've used your {getEffectiveLimit(getRateLimit()) === 3 ? '3' : '1'} daily scan! 💅</h3>
                <p className="text-sm text-gray-700 leading-relaxed">
                  The AI is literally exhausted from all this main character energy. It needs to recharge its batteries to give you the high-octane sweetness you deserve.
                </p>
                
                <div className="bg-white border-2 border-gray-400 p-4 font-mono">
                  <p className="text-[10px] text-gray-500 mb-1">⏳ NEXT SCAN UNLOCKS IN:</p>
                  <p className="text-2xl font-bold text-dark-blue tracking-widest">{countdown}</p>
                </div>

                <div className="space-y-3">
                  <p className="text-xs text-gray-600 italic">
                    Can’t wait? Share your Style ID to your IG Story to help the engine cool down faster! 🚀
                  </p>
                  <button 
                    onClick={() => {
                      handleShareWishlist();
                      setShowOverload(false);
                    }}
                    className="retro-button w-full flex items-center justify-center gap-2"
                  >
                    <Share2 size={18} />
                    SHARE FOR BONUS SCAN! ✨
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Notification */}
      <AnimatePresence>
        {successMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] retro-window bg-green-50 border-green-400 p-4 flex items-center gap-3 shadow-2xl"
          >
            <Sparkles className="text-green-600" size={20} />
            <span className="font-bold text-green-700 text-sm uppercase tracking-tight">
              {successMessage}
            </span>
          </motion.div>
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
                <h3 className="text-xl font-bold text-dark-blue uppercase tracking-tight">Memory Full!</h3>
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
      <footer className="mt-12 mb-8 text-center space-y-4">
        <div className="flex justify-center gap-6">
          <button 
            onClick={() => setCurrentView('PRIVACY')}
            className="text-[10px] font-bold text-dark-blue/40 uppercase tracking-widest hover:text-barbie-pink transition-colors"
          >
            PRIVACY POLICY
          </button>
          <button 
            onClick={() => setCurrentView('TERMS')}
            className="text-[10px] font-bold text-dark-blue/40 uppercase tracking-widest hover:text-barbie-pink transition-colors"
          >
            TERMS OF SERVICE
          </button>
        </div>
        <p className="text-[10px] font-bold text-dark-blue/40 uppercase tracking-[0.4em]">
          © 2026 STYLESNAP AI
        </p>
      </footer>

      <style>{`
        .prose strong { color: #d6619e; font-weight: 900; text-transform: uppercase; }
      `}</style>
    </div>
  );
}
