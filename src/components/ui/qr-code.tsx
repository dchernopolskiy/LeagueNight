"use client";

import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { QrCode, Download } from "lucide-react";
import { useRef } from "react";

interface QRCodeDialogProps {
  url: string;
  title: string;
  description?: string;
  size?: number;
}

export function QRCodeDialog({ url, title, description, size = 256 }: QRCodeDialogProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  const downloadQR = () => {
    if (!qrRef.current) return;

    const svg = qrRef.current.querySelector("svg");
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    canvas.width = size;
    canvas.height = size;

    img.onload = () => {
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL("image/png");
      const downloadLink = document.createElement("a");
      downloadLink.download = `${title.replace(/\s+/g, "-").toLowerCase()}-qr.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };

    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" className="gap-2" />}>
        <QrCode className="h-4 w-4" />
        QR Code
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
            <p className="text-xs text-muted-foreground break-all max-w-xs">
              {url}
            </p>
          </div>
          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                navigator.clipboard.writeText(url);
              }}
            >
              Copy Link
            </Button>
            <Button
              variant="default"
              className="flex-1 gap-2"
              onClick={downloadQR}
            >
              <Download className="h-4 w-4" />
              Download QR
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
