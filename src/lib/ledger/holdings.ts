import Decimal from "decimal.js";
import type { HoldingPosition, RealisedPlEvent, TransactionLeg } from "./types";

const ZERO = new Decimal(0);

/**
 * Computes current holdings and realised P/L from an account's asset legs,
 * using the average-cost method. Legs are processed in execution order:
 *  - Acquisitions (positive quantityDelta — buys, transfer_in) add quantity
 *    and gbpValue to the running cost basis.
 *  - Disposals (negative quantityDelta — sells, transfer_out) remove
 *    quantity at the average cost per unit held immediately before the
 *    disposal. Only a "sell" books a RealisedPlEvent; a transfer_out
 *    carries cost basis onward without realising a gain/loss.
 */
export function computeHoldings(legs: TransactionLeg[]): {
  holdings: HoldingPosition[];
  realisedPlEvents: RealisedPlEvent[];
} {
  const assetLegs = legs
    .filter(
      (leg): leg is TransactionLeg & { assetId: string; quantityDelta: Decimal } =>
        leg.legType === "asset" && leg.assetId !== null && leg.quantityDelta !== null,
    )
    .slice()
    .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());

  const positions = new Map<string, { quantity: Decimal; costBasis: Decimal }>();
  const realisedPlEvents: RealisedPlEvent[] = [];

  for (const leg of assetLegs) {
    const { assetId, quantityDelta: delta } = leg;
    const current = positions.get(assetId) ?? { quantity: ZERO, costBasis: ZERO };

    if (delta.isZero()) continue;

    if (delta.isPositive()) {
      positions.set(assetId, {
        quantity: current.quantity.plus(delta),
        costBasis: current.costBasis.plus(leg.gbpValue),
      });
      continue;
    }

    // Disposal: remove quantity at the average cost per unit held just
    // before this leg.
    const quantityRemoved = delta.abs();
    const avgCostBefore = current.quantity.isZero()
      ? ZERO
      : current.costBasis.dividedBy(current.quantity);
    const costBasisRemoved = avgCostBefore.times(quantityRemoved);

    positions.set(assetId, {
      quantity: current.quantity.plus(delta),
      costBasis: current.costBasis.minus(costBasisRemoved),
    });

    if (leg.transactionType === "sell") {
      realisedPlEvents.push({
        transactionId: leg.transactionId,
        assetId,
        quantitySold: quantityRemoved,
        proceedsGbp: leg.gbpValue,
        costBasisRemovedGbp: costBasisRemoved,
        realisedPlGbp: leg.gbpValue.minus(costBasisRemoved),
      });
    }
  }

  const holdings: HoldingPosition[] = Array.from(positions.entries()).map(
    ([assetId, { quantity, costBasis }]) => ({
      assetId,
      quantity,
      costBasisGbp: costBasis,
      averageCostGbp: quantity.isZero() ? ZERO : costBasis.dividedBy(quantity),
    }),
  );

  return { holdings, realisedPlEvents };
}
