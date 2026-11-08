import type { Distribution } from "@/types/transaction";
import {
  distributionsEqual,
  formatDistributionShort,
} from "@/utils/distribution";

export default function DistributionMismatchBanner({
  monthDistribution,
  profileDistribution,
  className = "",
}: {
  monthDistribution: Distribution | null | undefined;
  profileDistribution: Distribution | null | undefined;
  className?: string;
}) {
  if (!monthDistribution || !profileDistribution) return null;
  if (distributionsEqual(monthDistribution, profileDistribution)) return null;

  return (
    <div
      role="status"
      className={`rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800 ${className}`.trim()}
    >
      Este mes: {formatDistributionShort(monthDistribution)} · Próximo mes:{" "}
      {formatDistributionShort(profileDistribution)}
    </div>
  );
}
