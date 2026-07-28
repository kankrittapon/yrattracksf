import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({request});
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: ((cookiesToSet) => {
        cookiesToSet.forEach(({name, value}) => request.cookies.set(name, value));
        response = NextResponse.next({request});
        cookiesToSet.forEach(({name, value, options}) => response.cookies.set(name, value, options));
      }) satisfies SetAllCookies,
    },
  });
  const {data: {user}} = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (path === "/public" || path.startsWith("/public/")) return response;
  if (!user && path !== "/login") {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    return NextResponse.redirect(login);
  }
  if (user && path === "/login") {
    const overview = request.nextUrl.clone();
    overview.pathname = "/overview";
    return NextResponse.redirect(overview);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
