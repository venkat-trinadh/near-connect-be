import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((payload) => {
        // Allow controllers to pass a custom message alongside data
        const isStructured =
          payload &&
          typeof payload === 'object' &&
          'message' in payload &&
          'data' in payload;

        return {
          success: true,
          message: isStructured ? payload.message : 'Success',
          data: isStructured ? payload.data : payload,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
