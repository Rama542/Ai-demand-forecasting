import { SuspenseSlot } from "@/components/SuspenseSlot";
import ResearchClient from "./research-client";

export const metadata = { title: "Stock research" };

export default function Page() {
  return (
    <SuspenseSlot>
      <ResearchClient />
    </SuspenseSlot>
  );
}