import { SuspenseSlot } from "@/components/SuspenseSlot";
import BacktestingClient from "./backtesting-client";

export const metadata = { title: "Backtesting" };

export default function Page() {
  return (
    <SuspenseSlot>
      <BacktestingClient />
    </SuspenseSlot>
  );
}