/**
 * Données structurées schema.org. Bloc de données (non exécuté) ; « < » est échappé pour
 * qu'aucun contenu (nom de produit…) ne puisse fermer la balise script.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
