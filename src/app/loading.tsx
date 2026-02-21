export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950">
      <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mb-4" />
      <p className="text-gray-400">Yükleniyor...</p>
    </div>
  );
}
