import Decimal from "decimal.js";
import type { HoldingPosition } from "./types";

/**
 * A split (or reverse split, ratio < 1) changes quantity and per-unit
 * average cost by the ratio, but must never change total cost basis — the
 * position is worth the same total amount immediately before and after.
 */
export function applySplit(
  position: HoldingPosition,
  ratio: Decimal,
): HoldingPosition {
  if (!ratio.isPositive()) {
    throw new Error("Split ratio must be positive");
  }

  const newQuantity = position.quantity.times(ratio);

  return {
    assetId: position.assetId,
    quantity: newQuantity,
    costBasisGbp: position.costBasisGbp,
    averageCostGbp: newQuantity.isZero()
      ? new Decimal(0)
      : position.costBasisGbp.dividedBy(newQuantity),
  };
}
