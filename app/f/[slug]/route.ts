import { GET as publicGet, POST as publicPost } from "../../api/marketing-public/route";

type RouteContext = { params: Promise<{ slug: string }> };

async function forward(request: Request, context: RouteContext, handler: (request: Request) => Promise<Response>) {
  const { slug } = await context.params;
  const url = new URL(request.url);
  url.searchParams.set("slug", slug);
  const forwarded = new Request(url, request);
  return handler(forwarded);
}

export async function GET(request: Request, context: RouteContext) {
  return forward(request, context, publicGet);
}

export async function POST(request: Request, context: RouteContext) {
  return forward(request, context, publicPost);
}
