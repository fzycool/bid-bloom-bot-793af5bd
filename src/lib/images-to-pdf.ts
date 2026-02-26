import jsPDF from 'jspdf';

export async function imagesToPdf(imageUrls: string[]): Promise<Blob> {
  // Load first image to determine dimensions
  const firstImg = await loadImage(imageUrls[0]);
  const isLandscape = firstImg.width > firstImg.height;
  const orientation = isLandscape ? 'l' : 'p';

  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [firstImg.width, firstImg.height],
  });

  for (let i = 0; i < imageUrls.length; i++) {
    const img = await loadImage(imageUrls[i]);
    if (i > 0) {
      const landscape = img.width > img.height;
      pdf.addPage([img.width, img.height], landscape ? 'l' : 'p');
    }
    pdf.addImage(img, 'PNG', 0, 0, img.width, img.height);
  }

  return pdf.output('blob');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
