import { History } from '@/features/audit/history';
import { ReceiptDetailScreen } from '@/features/stock-receipts/receipt-detail-screen';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <ReceiptDetailScreen
      id={id}
      history={<History type="stock-receipts" id={id} />}
    />
  );
}
