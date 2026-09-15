import { CATEGORY_META } from "@/utils/category";
import type { Category } from "@/types/transaction";
import MaskIcon from "@/components/MaskIcon";
import homeIcon from "@/assets/icons/home.svg";
import bagIcon from "@/assets/icons/bag.svg";
import piggyBankIcon from "@/assets/icons/piggy-bank.svg";

const CATEGORY_ICONS: Record<Category, string> = {
  necesidad: homeIcon,
  ocio: bagIcon,
  ahorro: piggyBankIcon,
};

export default function CategoryIcon({
  category,
  size = "h-9 w-9",
}: {
  category: Category;
  size?: string;
}) {
  const meta = CATEGORY_META[category];

  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-full ${meta.bg} ${meta.text}`}
    >
      <MaskIcon src={CATEGORY_ICONS[category]} />
    </span>
  );
}
