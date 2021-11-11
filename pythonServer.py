# https://www.py4u.net/discuss/1001567

#Use to create local host
import http.server
import socketserver

PORT = 1337

Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({
      ".js": "application/javascript"
});

httpd = socketserver.TCPServer(("", PORT), Handler)
httpd.serve_forever()