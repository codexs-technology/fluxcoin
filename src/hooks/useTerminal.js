import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

export function useTerminal() {
  const terminalLogs = useAppStore((s) => s.terminalLogs);
  const addLog = useAppStore((s) => s.addLog);
  const bottomRef = useRef(null);

  // Auto-scroll to bottom on new log
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  return {
    terminalLogs,
    addLog,
    bottomRef
  };
}
