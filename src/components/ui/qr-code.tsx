"use client";

import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { QrCode, Download, Printer } from "lucide-react";
import { useRef } from "react";

interface QRCodeDialogProps {
  url: string;
  title: string;
  description?: string;
  size?: number;
}

export function QRCodeDialog({ url, title, description, size = 256 }: QRCodeDialogProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  const handlePrint = async () => {
    if (!qrRef.current) return;

    const svg = qrRef.current.querySelector("svg");
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    // Higher resolution for better quality
    const scale = 2;
    canvas.width = size * scale;
    canvas.height = size * scale;

    img.onload = () => {
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size * scale, size * scale);
      const pngFile = canvas.toDataURL("image/png");

      // Create a printable HTML page with the QR code
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${title}</title>
          <style>
            @page {
              size: auto;
              margin: 0mm;
            }
            @media print {
              html, body {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100%;
              }
            }
            body {
              margin: 0;
              padding: 40px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
            }
            h1 {
              font-size: 32px;
              margin: 0 0 16px 0;
              text-align: center;
            }
            p {
              font-size: 14px;
              color: #666;
              margin: 8px 0;
              text-align: center;
            }
            .qr-container {
              margin: 24px 0;
              padding: 16px;
              background: white;
              border: 2px solid #e5e7eb;
              border-radius: 8px;
            }
            .url {
              font-size: 12px;
              color: #666;
              word-break: break-all;
              max-width: 400px;
              font-family: monospace;
            }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          ${description ? `<p>${description}</p>` : ''}
          <div class="qr-container">
            <img src="${pngFile}" alt="QR Code" width="${size}" height="${size}" />
          </div>
          <p class="url">${url}</p>
        </body>
        </html>
      `);
      printWindow.document.close();

      // Trigger print dialog
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    };

    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <Dialog>
        <DialogTrigger render={<Button variant="outline" size="sm" className="gap-2" />}>
          <QrCode className="h-4 w-4" />
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div ref={qrRef} className="bg-white p-4 rounded-lg border">
              <QRCodeSVG
                value={url}
                size={size}
                level="H"
                includeMargin={false}
              />
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground break-all max-w-xs font-mono">
                {url}
              </p>
            </div>
            <div className="flex gap-2 w-full">
              <Button
                variant="default"
                className="w-full gap-2"
                onClick={handlePrint}
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
  );
}

interface InlineQRCodeProps {
  url: string;
  size?: number;
  className?: string;
}

export function InlineQRCode({ url, size = 128, className = "" }: InlineQRCodeProps) {
  return (
    <div className={`bg-white p-2 rounded-lg border inline-block ${className}`}>
      <QRCodeSVG
        value={url}
        size={size}
        level="H"
        includeMargin={false}
      />
    </div>
  );
}
