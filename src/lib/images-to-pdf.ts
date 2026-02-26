import jsPDF from 'jspdf';

export async function imagesToPdf(imageUrls: string[]): Promise<Blob> {
  // Load first image to determine dimensions
  const firstImg = await loadImageAsDataUrl(imageUrls[0]);
  const orientation = firstImg.width > firstImg.height ? 'l' : 'p';

  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [firstImg.width, firstImg.height],
  });

  for (let i = 0; i < imageUrls.length; i++) {
    const img = i === 0 ? firstImg : await loadImageAsDataUrl(imageUrls[i]);
    if (i > 0) {
      const landscape = img.width > img.height;
      pdf.addPage([img.width, img.height], landscape ? 'l' : 'p');
    }
    pdf.addImage(img.dataUrl, 'PNG', 0, 0, img.width, img.height);
  }

  return pdf.output('blob');
}

interface ImageData {
  dataUrl: string;
  width: number;
  height: number;
}

async function loadImageAsDataUrl(src: string): Promise<ImageData> {
  // Fetch as blob to avoid CORS issues with HTMLImageElement
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
  
  // Convert blob to data URL
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  // Get dimensions using a temporary image
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });

  return { dataUrl, width, height };
}
