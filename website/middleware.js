// Vercel Routing Middleware: admin.smeter.app shows the admin dashboard at its
// root. (A vercel.json rewrite can't do this: the website's own index.html is
// served before rewrites are considered.) Runs before the static files.
export const config = { matcher: ['/'] };

export default function middleware(request) {
  const host = new URL(request.url).hostname;
  if (host.startsWith('admin.')) {
    return new Response(null, {
      headers: { 'x-middleware-rewrite': new URL('/admin/index.html', request.url).toString() },
    });
  }
  // Anything else: carry on to the static site.
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}
