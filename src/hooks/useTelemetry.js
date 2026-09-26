import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

export function useTelemetry() {
  const telemetry = useAppStore((s) => s.telemetry);
  const tickTelemetry = useAppStore((s) => s.tickTelemetry);

  useEffect(() => {
    const interval = setInterval(() => {
      tickTelemetry();
    }, 2500);
    return () => clearInterval(interval);
  }, [tickTelemetry]);

  return telemetry;
}
