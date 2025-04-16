import axios, { AxiosResponse } from 'axios';
import { PrismaClient } from '../src/generated/client';
import _ from 'lodash';

const prisma = new PrismaClient();
const API_URL = 'https://api.themoviedb.org/3/movie';
const BATCH_SIZE = 40;

function asyncDebounce<F extends (...args: any[]) => Promise<any>>(
  func: F,
  wait?: number,
) {
  const debounced = _.debounce((resolve, reject, args: Parameters<F>) => {
    func(...args)
      .then(resolve)
      .catch(reject);
  }, wait);
  return (...args: Parameters<F>): ReturnType<F> =>
    new Promise((resolve, reject) => {
      debounced(resolve, reject, args);
    }) as ReturnType<F>;
}

async function getTmdbIds(
  batchSize: number,
  cursor: number | null,
): Promise<{ movie_id: number; imdb_id: number; tmdb_id: number }[]> {
  const links = await prisma.links.findMany({
    take: batchSize,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { movie_id: cursor } : undefined,
    where: {
      movie: { metadata: { equals: {} } },
    },
    orderBy: { movie_id: 'asc' },
  });

  return links;
}

async function fetchMoviesDetails(ids: number[]) {
  const results = await Promise.allSettled(
    ids.map((id) =>
      axios.get(`${API_URL}/${id}`, {
        headers: { Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}` },
      }),
    ),
  );

  return results
    .filter(
      (result): result is PromiseFulfilledResult<AxiosResponse> =>
        result.status === 'fulfilled',
    )
    .map(({ value }) => value.data);
}

async function saveMetadataToDb(
  data: any[], // TODO: add tmdb response interface
  moviesIds: { movie_id: number; tmdb_id: number }[],
): Promise<number> {
  if (!moviesIds.length || !data.length) {
    return 0;
  }

  const result = await Promise.allSettled(
    moviesIds
      .map(({ movie_id, tmdb_id }) => {
        const metadata = data.find((m) => m.id === tmdb_id);
        if (!metadata) return [];
        return prisma.movies.update({
          where: { movie_id },
          data: {
            metadata,
          },
        });
      })
      .flat(),
  );

  return result.filter((r) => r.status === 'fulfilled').length;
}

async function main() {
  const debouncedMoviesFetch = asyncDebounce(fetchMoviesDetails, 1000);
  let updatedItemsCount = 0;
  let cursor = null;
  while (true) {
    const links = await getTmdbIds(BATCH_SIZE, cursor);
    if (!links?.length) {
      break;
    }
    cursor = links[links.length - 1].movie_id;
    const moviesDetails: any = await debouncedMoviesFetch(
      links.map((l) => l.tmdb_id),
    );
    const numberOfUpdatedRecords = await saveMetadataToDb(moviesDetails, links);
    updatedItemsCount += numberOfUpdatedRecords;
    console.log(`Updated items count: ${updatedItemsCount}`);
  }
}

main();
