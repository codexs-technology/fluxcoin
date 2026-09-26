/**
 * Calculates dynamic activation fee based on tier, quantity, and network gas pressure.
 */
export function calculateActivationFee(tierId, quantity, gasPressure = 25) {
  const baseFees = {
    retail: 50,
    pro: 250,
    institutional: 12000
  };

  const base = baseFees[tierId] || 50;
  const numQty = parseFloat(quantity) || 0;
  
  // Scale fee slightly with quantity (0.005% of quantity volume)
  const volumeSurcharge = numQty * 0.00005;
  // Dynamic gas factor
  const gasAdjustment = (gasPressure / 25) * (base * 0.08);

  const totalFee = base + volumeSurcharge + gasAdjustment;
  return Math.round(totalFee * 100) / 100;
}
