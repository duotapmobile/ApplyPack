import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentPage } from "@/components/marketing/content-page";
import { publicPages } from "@/content/public-pages";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return Object.keys(publicPages).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = publicPages[(await params).slug];
  if (!page) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: "/" + page.slug },
    openGraph: {
      title: page.title,
      description: page.description,
      type: "website",
      url: "/" + page.slug,
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: ["/opengraph-image"],
    },
  };
}

export default async function MarketingPage({ params }: PageProps) {
  const page = publicPages[(await params).slug];
  if (!page) notFound();
  return <ContentPage page={page} />;
}
