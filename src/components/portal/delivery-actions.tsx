export function DeliveryActions({ jobLabel }: { itemId: string; deliveredAt: string; jobLabel: string }) {
  return <div className="delivery-actions"><p>Historical documents for {jobLabel} require review. Contact support to request a current delivery or factual correction.</p></div>;
}
