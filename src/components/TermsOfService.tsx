import React from 'react';
import { motion } from 'motion/react';
import { FileText, ArrowLeft } from 'lucide-react';

interface TermsOfServiceProps {
  onBack: () => void;
}

const TermsOfService: React.FC<TermsOfServiceProps> = ({ onBack }) => {
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
          <FileText className="text-barbie-pink" size={32} />
        </div>
        <h1 className="text-4xl font-black text-dark-blue italic uppercase tracking-tighter">TERMS_OF_SERVICE.EXE</h1>
      </div>

      <div className="prose prose-pink max-w-none space-y-6 text-gray-700 font-medium">
        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">1. ACCEPTANCE OF TERMS</h2>
          <p>
            By accessing or using StyleSnap AI, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this site.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">2. USE LICENSE</h2>
          <p>
            Permission is granted to temporarily download one copy of the materials (information or software) on StyleSnap AI's website for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Modify or copy the materials;</li>
            <li>Use the materials for any commercial purpose, or for any public display (commercial or non-commercial);</li>
            <li>Attempt to decompile or reverse engineer any software contained on StyleSnap AI's website;</li>
            <li>Remove any copyright or other proprietary notations from the materials; or</li>
            <li>Transfer the materials to another person or "mirror" the materials on any other server.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">3. DISCLAIMER</h2>
          <p>
            The materials on StyleSnap AI's website are provided on an 'as is' basis. StyleSnap AI makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">4. LIMITATIONS</h2>
          <p>
            In no event shall StyleSnap AI or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on StyleSnap AI's website, even if StyleSnap AI or a StyleSnap AI authorized representative has been notified orally or in writing of the possibility of such damage.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">5. REVISIONS AND ERRATA</h2>
          <p>
            The materials appearing on StyleSnap AI's website could include technical, typographical, or photographic errors. StyleSnap AI does not warrant that any of the materials on its website are accurate, complete, or current. StyleSnap AI may make changes to the materials contained on its website at any time without notice.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-dark-blue uppercase border-b-2 border-barbie-pink/20 pb-2">6. GOVERNING LAW</h2>
          <p>
            These terms and conditions are governed by and construed in accordance with the laws of California and you irrevocably submit to the exclusive jurisdiction of the courts in that State or location.
          </p>
        </section>
      </div>

      <div className="mt-12 pt-8 border-t-2 border-dashed border-gray-200 text-center">
        <p className="text-xs text-gray-400 uppercase font-bold tracking-widest">LAST UPDATED: MARCH 22, 2026</p>
      </div>
    </motion.div>
  );
};

export default TermsOfService;
