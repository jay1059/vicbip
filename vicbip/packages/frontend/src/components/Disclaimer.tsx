import React from 'react';

export function Disclaimer(): React.ReactElement {
  return (
    <footer
      className="fixed bottom-0 left-0 right-0 h-8 flex items-center justify-center bg-slate-100 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 z-30"
      role="contentinfo"
    >
      <p className="text-slate-500 dark:text-slate-400" style={{ fontSize: '11px' }}>
        VicBIP risk scores are indicative screening tools only and do not constitute a structural
        engineering assessment. Data sourced from DTP Victoria (CC BY 4.0).
      </p>
    </footer>
  );
}
