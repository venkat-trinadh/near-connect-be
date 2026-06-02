import { HttpException, InternalServerErrorException } from "@nestjs/common"


export const catchBlock = (err: any) => {
    console.log(err)
    if (err instanceof HttpException) {
        throw err;
    }
    throw new InternalServerErrorException('Something went wrong')
}