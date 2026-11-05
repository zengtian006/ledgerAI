import { CATEGORY_STYLE, dayLabel, money } from '../utils.js';
import { ChevronRight } from './Icons.jsx';

// One row of an `.ios-group` list (Settings-style rounded-square icon, amount, disclosure chevron)
export default function ReceiptRow({ receipt, onClick, showDate = true }) {
  const style = CATEGORY_STYLE[receipt.category] ?? CATEGORY_STYLE.Other;
  return (
    <button onClick={onClick} className="ios-press flex w-full items-center gap-3 px-4 py-2.5 text-left">
      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] text-[16px]" style={{ background: style.color }}>
        {style.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] leading-snug">{receipt.merchant_name}</span>
        <span className="block text-[13px] text-ios-secondary">
          {receipt.category}
          {showDate && ` · ${dayLabel(receipt.transaction_date)}`}
        </span>
      </span>
      <span className="text-[17px] tabular-nums">{money(receipt.total_amount, receipt.currency)}</span>
      <ChevronRight width={13} height={13} className="shrink-0 text-[#c4c4c7]" />
    </button>
  );
}
