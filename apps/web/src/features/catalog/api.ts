import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductDto, ProductInput } from '@wd/shared';
import { api } from '../../services/api';
import { qk } from '../../services/queryKeys';

export function productsQueryOptions(all = false) {
  return queryOptions({
    queryKey: qk.products(all),
    queryFn: () => api.get<ProductDto[]>(`/products${all ? '?all=true' : ''}`),
    staleTime: 5 * 60 * 1000,
  });
}

export function useProducts(options: { all?: boolean } = {}) {
  return useQuery(productsQueryOptions(options.all ?? false));
}

export function useSaveProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProductInput }) =>
      id ? api.patch<ProductDto>(`/products/${id}`, input) : api.post<ProductDto>('/products', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.productsRoot });
      void queryClient.invalidateQueries({ queryKey: qk.inventory });
    },
  });
}
