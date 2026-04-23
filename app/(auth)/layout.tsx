import Link from "next/link";
import Image from "next/image";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const Layout = async ({ children }: { children: React.ReactNode }) => {
  const authInstance = await auth();
  const session = await authInstance.api.getSession({ headers: await headers() });

  if (session?.user) redirect("/");

  return (
    <main className="auth-layout">
      <section className="auth-left-section scrollbar-hide-default">
        <Link href="/" className="auth-logo">
          <Image
            src="/assets/icons/stock-market.svg"
            alt="Signalist logo"
            width={140}
            height={42}
            className="h-18 w-auto"
          />
        </Link>

        <div className="pb-6 lg:pb-8 flex-1">{children}</div>
      </section>

      <section className="auth-right-section">
        {/* =====  Testimonial Text ===== */}
       <div className="mb-4 lg:mb-8 text-left text-white">
    <p className="italic text-sm md:text-base lg:text-lg leading-relaxed mb-2">
      "StockPulse turned my watchlist into a proactive, AI-powered tool! Real-time market updates, personalized stock recommendations, and instant portfolio health alerts via WhatsApp and email keep me ahead of every move."
    </p>
    <p className="text-yellow-400 text-sm md:text-base">★★★★</p>
    <p className="mt-2 font-medium text-sm md:text-base">Alex Rivers</p>
    <p className="text-xs md:text-sm text-gray-300">Portfolio Manager</p>
  </div>

        {/* ===== Dashboard Image Section ===== */}
        <div className="w-full mt-4 lg:flex-1 lg:relative h-[280px] lg:h-auto relative">
          <Image
            src="/assets/images/dashboard.png"
            alt="Dashboard Preview"
            fill                                  
            sizes="(max-width: 1024px) 100vw, 55vw"
            className="object-contain object-top"
            priority
          />
        </div>
      </section>
    </main>
  );
};

export default Layout;
