import React from 'react';
import { motion } from 'motion/react';
import { Shield, ArrowLeft } from 'lucide-react';

interface PrivacyPolicyProps {
  onBack: () => void;
}

const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ onBack }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto p-6 md:p-12 bg-white retro-window"
    >
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-barbie-pink font-bold mb-8 hover:underline"
      >
        <ArrowLeft size={20} />
        BACK TO APP
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="p-3 bg-barbie-pink/10 rounded-xl border-2 border-barbie-pink">
          <Shield className="text-barbie-pink" size={32} />
        </div>
        <h1 className="text-4xl font-black text-dark-blue italic uppercase tracking-tighter">PRIVACY_POLICY.EXE</h1>
      </div>

      <div className="prose prose-pink max-w-none space-y-6 text-gray-700 font-medium">
        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">1. WELCOME TO STYLESNAP AI</h2>
          <p>
            Your privacy is iconic to us. This Privacy Policy explains how StyleSnap AI ("we", "us", or "our") collects, uses, and protects your information when you use our style analysis services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">2. INFORMATION WE COLLECT</h2>
          <p>
            We collect information you provide directly to us, such as your style preferences, fashion goals, and account information when you login via Google. We also collect technical data including:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Cookies:</strong> Small data files stored on your device to remember your session and preferences.</li>
            <li><strong>Device Information:</strong> Data about your browser, operating system, and IP address.</li>
            <li><strong>Usage Data:</strong> Information about how you interact with our style engine and shop.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">3. HOW WE USE YOUR DATA</h2>
          <p>
            We use your information to provide personalized style assessments, curated shopping recommendations, and to improve our AI models. We do not sell your personal data to third parties.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">4. GOOGLE ADSENSE & COOKIES</h2>
          <p>
            We use Google AdSense to serve advertisements. Google uses cookies to serve ads based on your previous visits to our website or other websites. You may opt out of personalized advertising by visiting <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer" className="text-barbie-pink underline">Google Ads Settings</a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">5. DATA SECURITY</h2>
          <p>
            We implement industry-standard security measures to protect your data. However, no method of transmission over the Internet is 100% secure.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">6. CONTACT US</h2>
          <p>
            If you have any questions about this policy, please contact us at privacy@stylesnap.ai.
          </p>
        </section>
      </div>

      <div className="mt-12 pt-8 border-t-2 border-dashed border-gray-200 text-center">
        <p className="text-xs text-gray-400 uppercase font-bold tracking-widest">LAST UPDATED: MARCH 22, 2026</p>
      </div>
    </motion.div>
  );
};

export default PrivacyPolicy;
