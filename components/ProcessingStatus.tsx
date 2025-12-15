import React from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { ProcessingState } from '../types';

interface ProcessingStatusProps {
  state: ProcessingState;
}

export const ProcessingStatus: React.FC<ProcessingStatusProps> = ({ state }) => {
  if (state.status === 'idle') return null;

  const isProcessing = ['analyzing', 'processing', 'generating'].includes(state.status);
  const isComplete = state.status === 'completed';
  const isError = state.status === 'error';

  let icon = <Loader2 className="w-6 h-6 animate-spin text-blue-600" />;
  let colorClass = "bg-blue-50 border-blue-200 text-blue-800";

  if (isComplete) {
    icon = <CheckCircle2 className="w-6 h-6 text-green-600" />;
    colorClass = "bg-green-50 border-green-200 text-green-800";
  } else if (isError) {
    icon = <AlertCircle className="w-6 h-6 text-red-600" />;
    colorClass = "bg-red-50 border-red-200 text-red-800";
  }

  const percentage = state.total > 0 ? Math.round((state.progress / state.total) * 100) : 0;

  return (
    <div className={`mt-6 p-4 rounded-lg border ${colorClass} transition-all`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          {icon}
          <span className="font-medium">{state.message}</span>
        </div>
        {isProcessing && state.total > 0 && (
          <span className="text-sm font-bold">{percentage}%</span>
        )}
      </div>

      {isProcessing && state.total > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2 overflow-hidden">
          <div 
            className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      )}

      {isError && (
         <div className="mt-2 text-sm text-red-700">
           {state.error}
         </div>
      )}
    </div>
  );
};
