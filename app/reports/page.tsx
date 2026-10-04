import { SuspenseSlot } from "@/components/SuspenseSlot";
import ReportsClient from "./reports-client";

export const metadata = { title: "Research reports" };

export default function Page() {
  return (
    <SuspenseSlot>
      <ReportsClient />
    </SuspenseSlot>
  );
}